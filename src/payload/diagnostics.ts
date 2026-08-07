import type { Diagnostic, Severity } from "../types.ts";

/**
 * Terse constructors for findings. Every payload module builds diagnostics
 * the same way so the shape can't drift between them, and so a reader
 * scanning a validator sees the rule rather than the plumbing.
 */
function make(
  severity: Severity,
  code: string,
  tag: string | null,
  message: string
): Diagnostic {
  return { severity, code, tag, message };
}

export const error = (code: string, tag: string | null, message: string) =>
  make("error", code, tag, message);

export const warning = (code: string, tag: string | null, message: string) =>
  make("warning", code, tag, message);

export const info = (code: string, tag: string | null, message: string) =>
  make("info", code, tag, message);

/**
 * Byte length as encoded, not `String.length`.
 *
 * `String.length` counts UTF-16 code units, so an emoji reads as 2 and a
 * CJK character as 1 — neither is what goes into the symbol. Every capacity
 * and budget decision in this library uses this instead. Getting it wrong
 * produces a code that is over capacity while the UI insists it fits.
 */
export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
