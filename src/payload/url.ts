import type { BuiltPayload, Diagnostic, Payload } from "../types.ts";
import { error, info, warning } from "./diagnostics.ts";

/**
 * A web address. The simplest payload and the most common, which is exactly
 * why the two findings below are worth making — both are invisible in every
 * generator I could find.
 */

/**
 * QR's alphanumeric mode encodes 2 characters per 11 bits (5.5 bits each)
 * against byte mode's 8, so a payload that fits this set is roughly 31%
 * smaller — often a whole version smaller.
 *
 * The set is uppercase only. That matters because it means a lowercase URL
 * is always encoded as bytes, and most people type lowercase URLs.
 */
const ALPHANUMERIC = new Set(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:"
);

function isAlphanumericEncodable(value: string): boolean {
  for (const character of value) if (!ALPHANUMERIC.has(character)) return false;
  return true;
}

/**
 * General-purpose link shorteners. Deliberately excludes first-party short
 * domains (youtu.be, amzn.to): the finding is about handing a stranger the
 * ability to repoint your printed code, and a company's own short domain for
 * its own content is a different proposition.
 */
const SHORTENERS = new Set([
  "bit.ly",
  "buff.ly",
  "cutt.ly",
  "goo.gl",
  "is.gd",
  "ow.ly",
  "rb.gy",
  "rebrand.ly",
  "shorturl.at",
  "t.co",
  "tiny.cc",
  "tinyurl.com",
]);

type UrlPayload = Extract<Payload, { kind: "url" }>;

export function buildUrl(payload: UrlPayload): BuiltPayload {
  const diagnostics: Diagnostic[] = [];
  const raw = payload.url.trim();

  if (raw.length === 0) {
    return {
      text: "",
      diagnostics: [error("payload-empty", "url", "Enter a web address.")],
    };
  }

  let parsed: URL | null = null;
  try {
    parsed = new URL(raw);
  } catch {
    parsed = null;
  }

  if (!parsed) {
    // Without a scheme a scanner shows the text and offers nothing to tap.
    // The code "works" — it just doesn't do the one thing it was made for,
    // which is why this is an error rather than advice.
    diagnostics.push(
      error(
        "url-not-absolute",
        "url",
        `"${raw}" has no scheme, so scanners will show it as plain text instead of offering to open it. Add https:// to the front.`
      )
    );
    return { text: raw, diagnostics };
  }

  if (parsed.protocol === "http:") {
    diagnostics.push(
      warning(
        "url-not-https",
        "url",
        "This points at http://. Anyone on the same network can read or alter the page it opens, and a printed code cannot be recalled once that matters."
      )
    );
  }

  if (SHORTENERS.has(parsed.hostname.toLowerCase())) {
    diagnostics.push(
      warning(
        "url-shortener-detected",
        "url",
        `${parsed.hostname} is a link shortener, so a third party decides where this code leads and can repoint or retire it. That is a dynamic QR code with the control handed to someone else. Encode the real destination — a longer address costs a slightly denser symbol, nothing more.`
      )
    );
  }

  // The saving only materialises if the WHOLE payload is alphanumeric-safe
  // afterwards, because a single lowercase character in the path drops the
  // entire string back to byte mode. Schemes and hostnames are
  // case-insensitive (RFC 3986 §3.1, §3.2.2) so they are safe to uppercase;
  // PATHS, QUERIES AND FRAGMENTS ARE NOT, and are never touched.
  const upshifted =
    parsed.protocol.toUpperCase() +
    "//" +
    parsed.host.toUpperCase() +
    parsed.pathname +
    parsed.search +
    parsed.hash;

  if (!isAlphanumericEncodable(raw) && isAlphanumericEncodable(upshifted)) {
    diagnostics.push(
      info(
        "url-alphanumeric-savings",
        "url",
        `Writing the scheme and host in capitals — ${upshifted} — encodes about 31% smaller, often a whole version smaller, because QR's compact alphanumeric mode is uppercase-only. Hosts are case-insensitive so it resolves identically. The path is left alone deliberately: paths are case-sensitive.`
      )
    );
  }

  return { text: raw, diagnostics };
}

/**
 * The uppercased form offered by `url-alphanumeric-savings`, or null when
 * there is nothing to gain. Exported so the UI can offer it as a one-click
 * swap rather than making someone retype it.
 */
export function alphanumericVariant(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  const upshifted =
    parsed.protocol.toUpperCase() +
    "//" +
    parsed.host.toUpperCase() +
    parsed.pathname +
    parsed.search +
    parsed.hash;
  if (isAlphanumericEncodable(raw.trim())) return null;
  return isAlphanumericEncodable(upshifted) ? upshifted : null;
}
