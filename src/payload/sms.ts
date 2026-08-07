import type { BuiltPayload, Diagnostic, Payload } from "../types.ts";
import { error, info, warning } from "./diagnostics.ts";

/**
 * A pre-filled text message.
 *
 * `SMSTO:<number>:<message>` rather than the RFC 5724 `sms:` scheme —
 * SMSTO is the ZXing convention and is what Android's and most third-party
 * scanners actually implement. `sms:` with a `?body=` parameter is the
 * standards-track form and is handled inconsistently, including being ignored
 * outright on some versions of iOS.
 */

type SmsPayload = Extract<Payload, { kind: "sms" }>;

export function buildSms(payload: SmsPayload): BuiltPayload {
  const diagnostics: Diagnostic[] = [];
  const number = payload.number.trim();
  const message = payload.message;

  if (number.length === 0) {
    diagnostics.push(
      error("payload-empty", "number", "Enter the number to text.")
    );
  }

  if (number.length > 0 && !number.startsWith("+")) {
    diagnostics.push(
      info(
        "sms-not-e164",
        "number",
        "Without a country code (+61…) this only works for people already in that country."
      )
    );
  }

  // The format has no escape mechanism: everything after the second colon is
  // the message, so a colon inside it is read by some parsers as the end of
  // the number field. There is nothing to fix in the encoding — the only
  // remedy is different wording, so say that plainly.
  if (message.includes(":")) {
    diagnostics.push(
      warning(
        "sms-colon-in-message",
        "message",
        "SMSTO has no way to escape a colon, and some scanners split the message at the first one. Rephrasing to avoid it is the only reliable fix."
      )
    );
  }

  const text =
    message.length > 0 ? `SMSTO:${number}:${message}` : `SMSTO:${number}`;
  return { text, diagnostics };
}
