/**
 * Shared data shapes for the whole library. Kept in one file with no imports
 * of its own, so every module — and everything that consumes them — agrees on
 * exactly what a "payload", a "plan" or a "verdict" is.
 *
 * Treat this file as a contract. Several modules are built against it
 * independently; changing a shape here is a change to all of them at once.
 */

/* ────────────────────────────────────────────────────────────────────────
   Diagnostics
   ──────────────────────────────────────────────────────────────────────── */

/**
 * What each level asserts. The line is drawn by consequence, not by how
 * wrong something looks:
 *
 * error   — the artifact is broken. It will not reliably scan as configured,
 *            or it encodes something other than what was asked for. A code
 *            whose decode does not round-trip is the clearest case; so is one
 *            whose modules fall below the printable floor at the requested
 *            size, because it cannot be produced at all.
 * warning — it scans now, and the margin is spent. It will fail under
 *            conditions it will realistically meet: a logo that has consumed
 *            most of the correction budget, a colour pairing that clears the
 *            contrast floor only in ideal light, a payload big enough that a
 *            business card is marginal.
 * info    — it's fine. Here is a materially better option, or something true
 *            you would want to know — that a Wi-Fi code is a readable copy of
 *            the password, or that uppercasing a host would shrink the symbol.
 *
 * The distinction that matters most: `error` means "this will not work",
 * and nothing else earns it. Advice, however strongly held, is not an error.
 */
export type Severity = "error" | "warning" | "info";

/**
 * One finding, from any stage — payload validation, geometry, appearance or
 * verification. Every stage shares this shape deliberately: a caller building
 * a report should not have to merge four differently-structured lists to get
 * "everything wrong with this code".
 *
 * Structurally compatible with dmarcbis's `Diagnostic` and with the site's
 * shared renderer at src/scripts/diagnostics/render.ts, which is why the
 * field is `tag` rather than the more natural `field` — one vocabulary
 * across both /bin tools is worth more than per-library naming.
 */
export interface Diagnostic {
  /**
   * Stable, machine-readable identifier — safe to switch on, to suppress in
   * a config, or to use as an i18n key.
   *
   * Codes never change meaning across versions. A new situation gets a new
   * code rather than repurposing an old one. `severity` is a judgement and
   * may be re-tuned; `code` is the API.
   */
  code: string;
  severity: Severity;
  /**
   * What the finding is about — a payload field (`"ssid"`, `"url"`), or a
   * facet of the artifact (`"logo"`, `"size"`, `"colour"`) — or null for a
   * finding about the code as a whole.
   */
  tag: string | null;
  /**
   * A human sentence, written for the person about to print this, not for
   * someone who already has ISO/IEC 18004 open. Where a number decides the
   * outcome, the message carries the number and the fix: "2.1 mm short at
   * 30 cm — widen to 30 mm" beats "too small".
   */
  message: string;
}

/* ────────────────────────────────────────────────────────────────────────
   Payloads
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Wi-Fi authentication type as written into the `T:` field.
 *
 * `WPA` covers WPA, WPA2, WPA3 and transition mode — iOS and most Android
 * builds treat it as a wildcard and handshake on whatever the router offers,
 * which makes it the right default even for WPA3. `SAE` is accepted here
 * because people ask for it, but selecting it earns a diagnostic: a great
 * many scanners fail on it. For a genuinely WPA3-only network the correct
 * encoding is `WPA` plus `wpa3Only`, which emits `R:1`.
 */
export type WifiSecurity = "WPA" | "WEP" | "SAE" | "nopass";

/** Fields for a contact card. Serialised as vCard 3.0 — see payload/vcard.ts
 * for why not 4.0. */
export interface VCardFields {
  firstName: string;
  lastName: string;
  organisation: string;
  title: string;
  phone: string;
  email: string;
  url: string;
  /** Free-text address, serialised into the ADR structured field. */
  address: string;
  note: string;
}

/**
 * Everything the tool can encode, as a discriminated union on `kind`.
 *
 * v1 ships these seven. Deliberately not present yet: mecard, geo, event,
 * upi, epc and otpauth — the last of which encodes a live shared secret and
 * needs an explicit acknowledgement flow before it can exist at all.
 */
export type Payload =
  | { kind: "url"; url: string }
  | { kind: "text"; text: string }
  | {
      kind: "wifi";
      ssid: string;
      password: string;
      security: WifiSecurity;
      /** Only true when the SSID genuinely is not broadcast. A wrong flag
       * here makes iOS fail to join, which is why it is not a free-form
       * convenience toggle. */
      hidden: boolean;
      /** Emits `R:1` — "transition mode disabled". Only for networks that
       * refuse WPA2 outright. */
      wpa3Only: boolean;
    }
  | { kind: "vcard"; fields: VCardFields }
  | { kind: "email"; to: string; subject: string; body: string }
  | { kind: "sms"; number: string; message: string }
  | { kind: "tel"; number: string };

/** The `kind` discriminator on its own, for iterating the type picker. */
export type PayloadKind = Payload["kind"];

/**
 * The result of serialising a Payload: the exact string that goes into the
 * symbol, plus anything found while building it.
 *
 * `text` is always produced, even when diagnostics contain an error — the UI
 * shows the assembled payload live, and blanking it on a validation failure
 * hides the very thing the person is trying to fix.
 */
export interface BuiltPayload {
  text: string;
  diagnostics: Diagnostic[];
}

/* ────────────────────────────────────────────────────────────────────────
   Encoding and geometry
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Error correction level. The percentages are of codewords recoverable, not
 * of area, and they are a budget for real-world damage — glare, creases, ink
 * spread, a thumb — not spare room for decoration. See ecc.ts.
 */
export type EccLevel = "L" | "M" | "Q" | "H";

/**
 * How the code will be produced. This drives the minimum module size, because
 * ink spread and dot gain differ by an order of magnitude between a screen
 * and a thermal label printer.
 */
export type PrintProcess =
  | "screen"
  | "laser"
  | "inkjet"
  | "offset"
  | "thermal"
  | "engraved";

/** The physical context a code will live in — the two questions that decide
 * how big it has to be. */
export interface PhysicalContext {
  /** How far away it will be scanned from, in millimetres. Drives the 10:1
   * minimum width. */
  scanDistanceMm: number;
  /** The width the person intends to print it at, in millimetres, excluding
   * the quiet zone. */
  targetWidthMm: number;
  process: PrintProcess;
}

/** Resolved physical measurements for a specific symbol at a specific size. */
export interface Geometry {
  /** Modules per side, excluding the quiet zone. 21 + 4·(version − 1). */
  moduleCount: number;
  /** ISO/IEC 18004 requires 4. Never rendered smaller. */
  quietZoneModules: number;
  /** Size of one module at `targetWidthMm`. The number that decides whether
   * this can be printed at all. */
  moduleSizeMm: number;
  /** The floor for `process`, below which modules stop resolving. */
  moduleFloorMm: number;
  /** Minimum overall width for `scanDistanceMm`, via the 10:1 rule. */
  minWidthMm: number;
  /** Total printed width including both quiet zones. What actually has to
   * fit on the page. */
  totalWidthMm: number;
  /** Export resolution needed to land modules on whole pixels at
   * `targetWidthMm`. */
  requiredDpi: number;
}

/**
 * A fully resolved code: what will be encoded, how, and at what physical
 * size. Everything downstream — rendering, verification, export — works from
 * this rather than re-deriving any of it.
 */
export interface QrPlan {
  /** The exact string encoded into the symbol. */
  text: string;
  /** 1–40. */
  version: number;
  ecc: EccLevel;
  /**
   * Row-major, `matrix[y][x]`, true meaning a dark module. Excludes the quiet
   * zone — renderers add it, so nothing downstream can accidentally omit it.
   */
  matrix: ReadonlyArray<ReadonlyArray<boolean>>;
  geometry: Geometry;
}

/* ────────────────────────────────────────────────────────────────────────
   Verification
   ──────────────────────────────────────────────────────────────────────── */

/**
 * One rung of the stress ladder. `pristine` is the control; the rest simulate
 * conditions a printed code actually meets. `atTargetSize` is the one that
 * matters most — passing pristine and failing there is the commonest
 * real-world failure and is invisible in every other generator.
 */
export type StressPass =
  | "pristine"
  | "atTargetSize"
  | "blur"
  | "lowLight"
  | "offAxis"
  | "glare"
  | "scuff";

/** The outcome of decoding one rung. */
export interface StressResult {
  pass: StressPass;
  /** True only when the decode succeeded AND the result matched the input
   * exactly. A decode that returns different text is a failure, not a pass. */
  ok: boolean;
  /** A small preview of what was decoded, for the UI strip. */
  thumbnail?: string;
}

/**
 * Overall state.
 *
 * `broken`   — the pristine decode failed or did not round-trip. The code
 *              does not work; nothing else matters.
 * `at-risk`  — pristine passed, one or more degraded passes did not.
 * `verified` — every pass decoded back to exactly the input.
 * `pending`  — verification has not finished. Never rendered as a result.
 */
export type VerdictState = "verified" | "at-risk" | "broken" | "pending";

/**
 * The headline result. Deliberately carries counts rather than a boolean:
 * "6 of 7" is a different, more honest claim than a green tick, and it is the
 * claim this tool exists to make.
 */
export interface Verdict {
  state: VerdictState;
  passes: number;
  total: number;
  results: StressResult[];
  diagnostics: Diagnostic[];
}
