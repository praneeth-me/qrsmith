import type { BuiltPayload, Diagnostic, Payload } from "../types.ts";
import { byteLength, error, info, warning } from "./diagnostics.ts";

/**
 * Wi-Fi network credentials, in the `WIFI:` URI that iOS 11+ and Android 10+
 * read natively from the camera.
 *
 * THE GRAMMAR, from §7.1 of the Wi-Fi Alliance WPA3 specification:
 *
 *   WIFI-qr   = "WIFI:" [type ";"] [trdisable ";"] ssid ";" [hidden ";"]
 *               [id ";"] [password ";"] [public-key ";"] ";"
 *   type      = "T:" *(unreserved)      ; security type
 *   trdisable = "R:" *(HEXDIG)          ; Transition Disable value
 *
 * so the field order is T, R, S, H, I, P, K — `R:` comes immediately after
 * `T:`, before the SSID. Most parsers scan for prefixes and do not care, but
 * the specification's own example is `WIFI:T:WPA;R:1;S:MyNet;P:MyPassword;;`
 * and there is no reason to emit anything else.
 *
 * The escaping convention comes from ZXing rather than the WPA3 document,
 * which asks for percent-encoding. Android backslash-escapes and does not
 * percent-decode, so ZXing is what the scanners in people's pockets actually
 * implement — and interoperating with those is the entire point.
 */

/**
 * Characters that terminate or confuse a field and must be backslash-escaped:
 * backslash, semicolon, comma, colon and double quote.
 *
 * THE ORDER TRAP. Escaping these with sequential replaces is the classic bug
 * in this format:
 *
 *     value.replace(/;/g, "\\;").replace(/\\/g, "\\\\")   // WRONG
 *
 * the second pass re-escapes the backslashes the first pass just added, so
 * `a;b` becomes `a\\;b` and the scanner reads a literal backslash followed by
 * a field terminator. A single character-class regex is immune: `replace`
 * scans left to right and never re-examines what it inserted, so a literal
 * `\;` in the input correctly becomes `\\\;` in one pass. That immunity is
 * the reason this is written as one regex, and there is a test asserting it.
 */
const WIFI_METACHARS = /[\\;,:"]/g;

function escapeWifi(value: string): string {
  return value.replace(WIFI_METACHARS, character => `\\${character}`);
}

function hasMetachar(value: string): boolean {
  // A fresh regex each time: a /g regex used with .test() carries lastIndex
  // between calls and returns true, then false, for identical input.
  return /[\\;,:"]/.test(value);
}

const ALL_HEX = /^[0-9A-Fa-f]+$/;

/**
 * ZXing's convention is that an all-hex value is wrapped in double quotes, so
 * a reader knows it is literal text rather than hex-encoded bytes. Quotes are
 * added after escaping so they are not themselves escaped.
 *
 * APPLIED TO THE SSID ONLY, AND TO A PASSWORD ONLY AT A REAL KEY LENGTH.
 *
 * The convention cuts both ways: if a parser does not strip the quotes it
 * joins with them included and the credential is simply wrong. So it is worth
 * paying only where the ambiguity actually exists.
 *
 * For a password it exists at exactly three lengths — a raw 64-digit WPA PMK,
 * and a 10- or 26-digit WEP key. At any other length no parser can read the
 * value as hex, because no key that size exists. Quoting anyway would take a
 * password like `12345678`, one of the commonest shapes there is, and hand it
 * to the scanner as `"12345678"`. An SSID has no such length rule — any
 * number of hex characters could in principle be decoded — so it keeps the
 * convention.
 */
function quoteIfHex(escaped: string, raw: string): string {
  return raw.length > 0 && ALL_HEX.test(raw) ? `"${escaped}"` : escaped;
}

/** Lengths at which an all-hex password is genuinely ambiguous. */
const AMBIGUOUS_HEX_KEY_LENGTHS = new Set([10, 26, 64]);

function quotePasswordIfAmbiguous(escaped: string, raw: string): string {
  return ALL_HEX.test(raw) && AMBIGUOUS_HEX_KEY_LENGTHS.has(raw.length)
    ? `"${escaped}"`
    : escaped;
}

type WifiPayload = Extract<Payload, { kind: "wifi" }>;

/** IEEE 802.11 PSK bounds: 8–63 printable ASCII, or exactly 64 hex. */
const PSK_MIN = 8;
const PSK_MAX = 63;

/** WEP keys are 40-bit or 104-bit: 5 or 13 ASCII, 10 or 26 hex. */
const WEP_ASCII_LENGTHS = [5, 13];
const WEP_HEX_LENGTHS = [10, 26];

/**
 * Passwords that a dictionary attack tries in its first breath. Not a
 * comprehensive list and not trying to be — the point is to catch the
 * genuinely thoughtless case, not to score entropy.
 */
const TRIVIAL_PASSWORDS = new Set([
  "password",
  "password1",
  "12345678",
  "123456789",
  "1234567890",
  "qwertyui",
  "guestwifi",
  "wifipassword",
  "letmein1",
  "changeme",
  "admin123",
  "welcome1",
  "internet",
]);

/**
 * Rough strength assessment for a PSK that is already the right length.
 *
 * Deliberately not an entropy score with a number attached: a number invites
 * gaming, and the useful signal here is binary — is this the kind of password
 * that falls to an offline dictionary attack on a captured handshake? WPA2
 * allows exactly that attack, which is the reason it matters at all.
 */
function weakness(password: string): string | null {
  const lower = password.toLowerCase();
  if (TRIVIAL_PASSWORDS.has(lower)) {
    return "this is on the first page of every password list";
  }
  if (/^\d+$/.test(password)) {
    return "digits only — a phone number or date falls to an offline attack in seconds";
  }
  if (/^[a-z]+$/.test(password)) {
    return "lowercase letters only";
  }
  if (new Set(password).size <= 4) {
    return "only a handful of distinct characters";
  }
  if (password.length < 12) {
    return "short enough to brute-force offline once someone has captured a handshake";
  }
  return null;
}

export function buildWifi(payload: WifiPayload): BuiltPayload {
  const diagnostics: Diagnostic[] = [];
  const { ssid, password, security, hidden, wpa3Only } = payload;

  /* ── SSID ─────────────────────────────────────────────────────────── */

  if (ssid.length === 0) {
    diagnostics.push(
      error("wifi-empty-ssid", "ssid", "A network name is required.")
    );
  }

  const ssidBytes = byteLength(ssid);
  if (ssidBytes > 32) {
    diagnostics.push(
      error(
        "wifi-ssid-too-long",
        "ssid",
        `A network name is limited to 32 bytes; this is ${ssidBytes}. Non-ASCII characters cost more than one byte each.`
      )
    );
  }

  /* ── Security type ────────────────────────────────────────────────── */

  const needsPassword = security !== "nopass";

  if (security === "nopass") {
    diagnostics.push(
      warning(
        "wifi-open-network",
        "security",
        "An open network encrypts nothing. Anyone within range reads every unencrypted request made over it, and can join without asking. Reasonable for a genuinely public hotspot sitting behind a captive portal; not for a home, office or anything with a printer on it."
      )
    );
  }

  if (security === "WEP") {
    diagnostics.push(
      warning(
        "wifi-wep-deprecated",
        "security",
        "WEP was broken in 2001 and the key can be recovered from a few minutes of captured traffic. The code will work, and the network is effectively open to anyone who wants in. If the router offers nothing better it is old enough to replace."
      )
    );
  }

  if (security === "SAE") {
    diagnostics.push(
      warning(
        "wifi-sae-compatibility",
        "security",
        'T:SAE is read by very few scanners and will silently fail to join on many phones. The WPA3 specification\'s own example for a WPA3-only network is "T:WPA;R:1" — WPA as the type, with transition mode disabled — because iOS and most Android builds treat T:WPA as a wildcard and negotiate the strongest protocol the router offers. Choose "WPA3 only" instead of this.'
      )
    );
  }

  if (wpa3Only && security === "WPA") {
    diagnostics.push(
      info(
        "wifi-wpa3-only-compat",
        "security",
        "R:1 tells the phone the network refuses WPA2, which is the strongest setting and the least compatible. WPA3 arrived in Android 10 and iOS 13, both 2019, and only became mandatory for new Wi-Fi certification in 2020 — so anything older, plus a lot of printers, smart TVs and IoT gear of any age, cannot join at all. Leave it off unless the router is genuinely WPA3-only."
      )
    );
  }

  if (wpa3Only && security !== "WPA") {
    diagnostics.push(
      warning(
        "wifi-wpa3only-ignored",
        "security",
        'The "WPA3 only" flag (R:1) is only meaningful alongside WPA. It is ignored here.'
      )
    );
  }

  /* ── Password ─────────────────────────────────────────────────────── */

  if (!needsPassword && password.length > 0) {
    diagnostics.push(
      error(
        "wifi-nopass-with-password",
        "password",
        'Security is set to "open", but a password was supplied. The password is discarded, and anyone scanning this joins an open network — set the security type to match the network.'
      )
    );
  }

  if (needsPassword && password.length === 0) {
    diagnostics.push(
      error(
        "wifi-password-required",
        "password",
        "This security type needs a password. Without one the code will not join the network."
      )
    );
  }

  if (needsPassword && password.length > 0) {
    if (security === "WEP") {
      // A key is acceptable under EITHER reading, and the two overlap: a
      // five-character key of hex letters ("abcde") is a perfectly valid
      // ASCII key that also happens to look hexadecimal. Testing hex first
      // and stopping there rejects it, which is wrong — the access point
      // takes it.
      const validAsAscii = WEP_ASCII_LENGTHS.includes(password.length);
      const validAsHex =
        ALL_HEX.test(password) && WEP_HEX_LENGTHS.includes(password.length);
      if (!validAsAscii && !validAsHex) {
        diagnostics.push(
          error(
            "wifi-wep-key-length",
            "password",
            `A WEP key is ${WEP_ASCII_LENGTHS.join(" or ")} characters, or ${WEP_HEX_LENGTHS.join(" or ")} hex digits. This is ${password.length} characters, which no access point will accept.`
          )
        );
      }
    } else {
      // 802.11 permits 8–63 characters, or exactly 64 hex digits for a raw
      // PMK. Outside that the access point cannot store it, so the code is
      // broken rather than merely weak.
      const isRawPmk = password.length === 64 && ALL_HEX.test(password);
      if (!isRawPmk && password.length < PSK_MIN) {
        diagnostics.push(
          error(
            "wifi-password-too-short",
            "password",
            `A WPA password must be at least ${PSK_MIN} characters; this is ${password.length}. No access point can be configured with it, so the code cannot work.`
          )
        );
      } else if (!isRawPmk && password.length > PSK_MAX) {
        diagnostics.push(
          error(
            "wifi-password-too-long",
            "password",
            `A WPA password is at most ${PSK_MAX} characters; this is ${password.length}. Only a raw 64-digit hex key may be longer.`
          )
        );
      } else if (!isRawPmk) {
        const problem = weakness(password);
        if (problem) {
          diagnostics.push(
            warning(
              "wifi-password-weak",
              "password",
              `This password is ${problem}. WPA2 lets an attacker capture one handshake from the car park and then guess offline, as fast as their hardware allows, with no further contact — so length is what protects you. Three or four unrelated words is stronger than a short scramble and far easier to read off a sign.`
            )
          );
        }
      }
    }
  }

  /* ── Hidden ───────────────────────────────────────────────────────── */

  if (hidden) {
    diagnostics.push(
      warning(
        "wifi-hidden-flag-risk",
        "hidden",
        "Only mark a network hidden if it genuinely does not broadcast its name. iOS fails to join when this flag is wrong, and the failure gives no clue why. Hiding an SSID is not a security measure either — the name is still in the clear in every client probe."
      )
    );
  }

  /* ── Escaping and assembly ────────────────────────────────────────── */

  const escapedSsid = quoteIfHex(escapeWifi(ssid), ssid);
  const escapedPassword = quotePasswordIfAmbiguous(
    escapeWifi(password),
    password
  );

  if (hasMetachar(ssid) || hasMetachar(password)) {
    diagnostics.push(
      warning(
        "wifi-metachar-escaped",
        "ssid",
        `Your network name or password contains one of \\ ; , : " — these have been escaped so scanners read them correctly. Check the encoded payload below matches what you expect.`
      )
    );
  }

  if (ssid.length > 0 && ALL_HEX.test(ssid)) {
    diagnostics.push(
      info(
        "wifi-hex-quoted",
        "ssid",
        "This network name is all hex digits, so it has been wrapped in quotes. Without them a scanner may read it as hex-encoded bytes rather than the name itself."
      )
    );
  }

  if (needsPassword && password.length > 0) {
    diagnostics.push(
      info(
        "wifi-secret-in-artifact",
        "password",
        "This code is a readable copy of your Wi-Fi password — a QR code is not encryption. Anyone who photographs it keeps the password until you change it, which means reprinting every sign. For anywhere public, use a guest network you can rotate."
      )
    );
  }

  // Field order per the specification: T, R, S, H, I, P, K. Fields that carry
  // no information are omitted rather than emitted empty — a good parser
  // skips unknown or blank fields and a bad one chokes on them.
  const fields = [`T:${security}`];
  if (wpa3Only && security === "WPA") fields.push("R:1");
  fields.push(`S:${escapedSsid}`);
  if (hidden) fields.push("H:true");
  if (needsPassword) fields.push(`P:${escapedPassword}`);

  return { text: `WIFI:${fields.join(";")};;`, diagnostics };
}
