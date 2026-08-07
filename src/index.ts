/**
 * Public entry point.
 *
 * Everything a consumer needs comes from here; nothing should reach into
 * src/ internals. The path alias in the site's tsconfig points at this file,
 * so moving the library to npm is a one-line change with no import churn.
 */
export { buildPayload } from "./lint.ts";
export { alphanumericVariant } from "./payload/url.ts";

export type {
  BuiltPayload,
  Diagnostic,
  EccLevel,
  Geometry,
  Payload,
  PayloadKind,
  PhysicalContext,
  PrintProcess,
  QrPlan,
  Severity,
  StressPass,
  StressResult,
  VCardFields,
  Verdict,
  VerdictState,
  WifiSecurity,
} from "./types.ts";
