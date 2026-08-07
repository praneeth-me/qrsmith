import type { BuiltPayload, Diagnostic, Payload } from "../types.ts";
import { byteLength, error, info, warning } from "./diagnostics.ts";

/**
 * A contact card, serialised as vCard 3.0.
 *
 * 3.0 RATHER THAN 4.0, deliberately. 4.0 is the newer standard and the better
 * document, but contact apps — Android's especially — map its fields
 * inconsistently, and a card that imports with the phone number in the wrong
 * slot is worse than one using an older version everything agrees on. 3.0's
 * N/FN/TEL/EMAIL/ORG are parsed correctly essentially everywhere.
 *
 * LINE FOLDING IS DELIBERATELY OMITTED. RFC 6350 §3.2 says lines should be
 * folded at 75 octets and parsers must unfold them. In a QR code the fold
 * costs three bytes per break (CRLF + space) to solve a problem — terminal
 * line width — that does not exist here, and unfolded cards are read
 * correctly by every scanner tested. Bytes are the scarce resource in this
 * medium, so they are spent on content.
 */

/**
 * Escape per RFC 6350 §3.4: backslash, comma and semicolon are escaped, and
 * literal newlines become the two-character sequence \n.
 *
 * Colon is NOT escaped — it is a delimiter only between the property name and
 * its value, and a colon inside a value is unambiguous. Escaping it anyway
 * produces a visible backslash in the imported contact.
 *
 * Written as a single character-class regex for the same reason as the Wi-Fi
 * escaper: sequential replaces would re-escape their own backslashes.
 */
function escapeVCard(value: string): string {
  return value
    .replace(/[\;,]/g, character => `\\${character}`)
    .replace(/\r\n|\r|\n/g, "\\n");
}

type VCardPayload = Extract<Payload, { kind: "vcard" }>;

/** Past this, a card is too dense to scan reliably at business-card size. */
const COMFORTABLE_BYTES = 300;

export function buildVCard(payload: VCardPayload): BuiltPayload {
  const diagnostics: Diagnostic[] = [];
  const f = payload.fields;

  const hasName = f.firstName.trim().length > 0 || f.lastName.trim().length > 0;
  if (!hasName) {
    diagnostics.push(
      error(
        "vcard-no-name",
        "name",
        "A contact card needs at least a first or last name. Without one, most phones refuse to save it."
      )
    );
  }

  const fullName = [f.firstName.trim(), f.lastName.trim()]
    .filter(Boolean)
    .join(" ");

  // CRLF is mandatory in vCard, not a stylistic choice — some parsers treat a
  // bare LF as a continuation and merge two properties into one.
  const lines: string[] = ["BEGIN:VCARD", "VERSION:3.0"];

  lines.push(
    `N:${escapeVCard(f.lastName.trim())};${escapeVCard(f.firstName.trim())};;;`
  );
  if (fullName) lines.push(`FN:${escapeVCard(fullName)}`);
  if (f.organisation.trim())
    lines.push(`ORG:${escapeVCard(f.organisation.trim())}`);
  if (f.title.trim()) lines.push(`TITLE:${escapeVCard(f.title.trim())}`);
  if (f.phone.trim())
    lines.push(`TEL;TYPE=CELL,VOICE:${escapeVCard(f.phone.trim())}`);
  if (f.email.trim())
    lines.push(`EMAIL;TYPE=INTERNET:${escapeVCard(f.email.trim())}`);
  if (f.url.trim()) lines.push(`URL:${escapeVCard(f.url.trim())}`);
  // ADR is structured as po-box;extended;street;locality;region;postcode;
  // country. A single free-text address goes in `street`, which is where
  // contact apps display it; splitting it heuristically guesses wrong.
  if (f.address.trim())
    lines.push(`ADR;TYPE=HOME:;;${escapeVCard(f.address.trim())};;;;`);
  if (f.note.trim()) lines.push(`NOTE:${escapeVCard(f.note.trim())}`);

  lines.push("END:VCARD");
  const text = lines.join("\r\n");

  const bytes = byteLength(text);
  if (bytes > COMFORTABLE_BYTES) {
    diagnostics.push(
      warning(
        "vcard-over-budget",
        "vcard",
        `This card is ${bytes} bytes, past the ~${COMFORTABLE_BYTES} where a symbol stays comfortable at business-card size. It will scan on screen and get marginal in print. Dropping the note or the address usually recovers it.`
      )
    );
  }

  if (f.email.trim() && !f.email.includes("@")) {
    diagnostics.push(
      warning(
        "vcard-email-suspect",
        "email",
        `"${f.email.trim()}" does not look like an email address. It will be saved exactly as written.`
      )
    );
  }

  if (f.phone.trim() && !f.phone.trim().startsWith("+")) {
    diagnostics.push(
      info(
        "vcard-phone-not-e164",
        "phone",
        "A number without a country code (+61…) only dials correctly for people already in that country. Anyone scanning from abroad gets a number that fails."
      )
    );
  }

  return { text, diagnostics };
}
