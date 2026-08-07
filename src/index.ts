/**
 * Public entry point.
 *
 * Only types so far — the modules that implement them land in later chunks.
 * This file exists now so that everything building against the contract in
 * types.ts imports from one stable place, and so a consumer never reaches
 * into src/ internals.
 */
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
