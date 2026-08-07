import type { BuiltPayload, Diagnostic, Payload } from "../types.ts";
import { error, info } from "./diagnostics.ts";

/**
 * A phone number, as a `tel:` URI per RFC 3966.
 *
 * Formatting characters are stripped: spaces, hyphens, brackets and dots are
 * presentational, and while most dialers tolerate them, `tel:` is defined in
 * terms of digits and a leading `+`. Stripping is safe and removes a class of
 * scanner disagreement for free.
 */

type TelPayload = Extract<Payload, { kind: "tel" }>;

const FORMATTING = /[\s\-().]/g;

export function buildTel(payload: TelPayload): BuiltPayload {
  const diagnostics: Diagnostic[] = [];
  const raw = payload.number.trim();

  if (raw.length === 0) {
    return {
      text: "",
      diagnostics: [error("payload-empty", "number", "Enter a phone number.")],
    };
  }

  const cleaned = raw.replace(FORMATTING, "");

  if (!/^\+?[0-9]+$/.test(cleaned)) {
    diagnostics.push(
      error(
        "tel-invalid",
        "number",
        `"${raw}" contains characters that are not digits. A scanner will offer to dial something that cannot be dialled.`
      )
    );
  }

  if (!cleaned.startsWith("+")) {
    diagnostics.push(
      info(
        "tel-not-e164",
        "number",
        "Without a country code (+61…) this only dials correctly for people already in that country — a real problem for anything printed and handed out."
      )
    );
  }

  return { text: `tel:${cleaned}`, diagnostics };
}
