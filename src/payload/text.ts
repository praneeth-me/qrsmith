import type { BuiltPayload, Diagnostic, Payload } from "../types.ts";
import { error, info } from "./diagnostics.ts";

/**
 * Arbitrary text. No structure, no rules — the escape hatch for anything the
 * typed builders do not cover.
 */

type TextPayload = Extract<Payload, { kind: "text" }>;

/** True when any character falls outside ISO-8859-1. */
function needsUtf8(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code !== undefined && code > 0xff) return true;
  }
  return false;
}

export function buildText(payload: TextPayload): BuiltPayload {
  const diagnostics: Diagnostic[] = [];
  const text = payload.text;

  if (text.length === 0) {
    diagnostics.push(error("payload-empty", "text", "Enter something to encode."));
  }

  // QR byte mode is ISO-8859-1 by default. Anything beyond it needs an ECI
  // header declaring UTF-8, which modern scanners honour and a handful of
  // older ones ignore — rendering the text as mojibake rather than failing,
  // which is the more confusing outcome of the two.
  if (needsUtf8(text)) {
    diagnostics.push(
      info(
        "text-mode-eci-utf8",
        "text",
        "This contains characters outside Latin-1, so the code declares UTF-8 with an ECI header. Current scanners handle it; a few older ones ignore the header and show garbled characters instead."
      )
    );
  }

  return { text, diagnostics };
}
