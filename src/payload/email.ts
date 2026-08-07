import type { BuiltPayload, Diagnostic, Payload } from "../types.ts";
import { error, info } from "./diagnostics.ts";

/**
 * A pre-filled email, as a `mailto:` URI per RFC 6068.
 *
 * The trap is the query string: subject and body must be percent-encoded, and
 * a raw space or ampersand in either truncates the message at that point in
 * most clients. `encodeURIComponent` handles everything RFC 6068 requires for
 * these two fields.
 */

type EmailPayload = Extract<Payload, { kind: "email" }>;

const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function buildEmail(payload: EmailPayload): BuiltPayload {
  const diagnostics: Diagnostic[] = [];
  const to = payload.to.trim();

  if (to.length === 0) {
    diagnostics.push(
      error("payload-empty", "to", "Enter the address this should write to.")
    );
  } else if (!LOOKS_LIKE_EMAIL.test(to)) {
    diagnostics.push(
      error(
        "email-invalid-address",
        "to",
        `"${to}" does not look like an email address, so the scanner will open a blank draft or nothing at all.`
      )
    );
  }

  const params: string[] = [];
  if (payload.subject.trim())
    params.push(`subject=${encodeURIComponent(payload.subject.trim())}`);
  if (payload.body.trim())
    params.push(`body=${encodeURIComponent(payload.body.trim())}`);

  if (payload.body.trim().length > 0) {
    diagnostics.push(
      info(
        "email-body-support",
        "body",
        "A pre-filled body is honoured by most mail apps but silently dropped by a few. Keep anything essential in the subject, which is universally supported."
      )
    );
  }

  const query = params.length > 0 ? `?${params.join("&")}` : "";
  return { text: `mailto:${to}${query}`, diagnostics };
}
