import type { BuiltPayload, Diagnostic, Payload } from "../types.ts";
import { byteLength, error, info, warning } from "./diagnostics.ts";

/**
 * Wi-Fi network credentials, in the `WIFI:` URI format that iOS 11+ and
 * Android 10+ read natively from the camera.
 *
 *   WIFI:T:WPA;S:<ssid>;P:<password>;H:true;R:1;;
 *
 * The format originates with ZXing and is described in §7.1 of the WPA3
 * specification. The two do not agree — WPA3 says non-printable characters
 * and semicolons are percent-encoded, while Android backslash-escapes them
 * per ZXing and does not percent-encode. This module follows ZXing, because
 * that is what the scanners in people's pockets actually implement.
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

/** True when a value is entirely hex digits. */
const ALL_HEX = /^[0-9A-Fa-f]+$/;

/**
 * An all-hex SSID or password is ambiguous: historically a bare hex string in
 * these fields could be read as hex-encoded bytes rather than as the literal
 * characters. Wrapping it in double quotes disambiguates, and is what ZXing
 * expects. The quotes are added *after* escaping so they are not themselves
 * escaped.
 */
function quoteIfHex(escaped: string, raw: string): string {
  return ALL_HEX.test(raw) && raw.length > 0 ? `"${escaped}"` : escaped;
}

type WifiPayload = Extract<Payload, { kind: "wifi" }>;

export function buildWifi(payload: WifiPayload): BuiltPayload {
  const diagnostics: Diagnostic[] = [];
  const { ssid, password, security, hidden, wpa3Only } = payload;

  if (ssid.length === 0) {
    diagnostics.push(
      error("wifi-empty-ssid", "ssid", "A network name is required.")
    );
  }

  // An SSID is at most 32 octets on the wire. Longer than that is not a
  // network anyone can join, so it is a mistake worth catching here rather
  // than after printing.
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

  const needsPassword = security !== "nopass";

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

  if (security === "SAE") {
    diagnostics.push(
      warning(
        "wifi-sae-compatibility",
        "security",
        'T:SAE is read by very few scanners and will silently fail to join on many phones. Use WPA instead — iOS and most Android builds treat it as a wildcard and handshake on whatever the router offers, including WPA3. If the network refuses WPA2 outright, keep WPA and enable "WPA3 only", which adds R:1.'
      )
    );
  }

  if (security === "WEP") {
    diagnostics.push(
      warning(
        "wifi-wep-deprecated",
        "security",
        "WEP has been broken for two decades and is trivially recoverable from captured traffic. The code will work; the network should not be in use."
      )
    );
  }

  if (hidden) {
    diagnostics.push(
      warning(
        "wifi-hidden-flag-risk",
        "hidden",
        "Only mark a network hidden if it genuinely does not broadcast its name. iOS fails to join when this flag is wrong, and the failure gives no clue why."
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

  const escapedSsid = quoteIfHex(escapeWifi(ssid), ssid);
  const escapedPassword = quoteIfHex(escapeWifi(password), password);

  if (WIFI_METACHARS.test(ssid) || WIFI_METACHARS.test(password)) {
    // `test` with a /g regex advances lastIndex; reset it so the next call
    // starts from the beginning. A stateful regex silently returning false
    // on alternate calls is its own classic bug.
    WIFI_METACHARS.lastIndex = 0;
    diagnostics.push(
      warning(
        "wifi-metachar-escaped",
        "ssid",
        `Your network name or password contains one of \\ ; , : " — these have been escaped so scanners read them correctly. Check the encoded payload below matches what you expect.`
      )
    );
  }
  WIFI_METACHARS.lastIndex = 0;

  if (ALL_HEX.test(ssid) && ssid.length > 0) {
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

  // Field order follows the ZXing convention. `R:1` is emitted only when it
  // means something, because unknown fields are skipped by good parsers and
  // choke bad ones. The doubled terminator at the end is part of the format.
  const fields = [`T:${security}`, `S:${escapedSsid}`];
  if (needsPassword) fields.push(`P:${escapedPassword}`);
  if (hidden) fields.push("H:true");
  if (wpa3Only && security === "WPA") fields.push("R:1");

  return { text: `WIFI:${fields.join(";")};;`, diagnostics };
}
