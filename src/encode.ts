import { encode as uqrEncode } from "../vendor/uqr.mjs";
import type {
  Diagnostic,
  EccLevel,
  PhysicalContext,
  QrPlan,
} from "./types.ts";
import { checkGeometry, moduleCountForVersion, resolveGeometry } from "./geometry.ts";
import {
  checkEccBudget,
  checkLogoPlacement,
  computeEccBudget,
  type EccBudget,
} from "./ecc.ts";

/**
 * Turns text into a resolved plan: the matrix, the version and level that were
 * chosen, and every physical measurement that follows from them.
 *
 * A thin wrapper over the vendored encoder on purpose. The encoding itself is
 * settled, audited work; the value this library adds sits either side of it —
 * getting the payload right on the way in, and knowing what the result means
 * physically on the way out.
 */

/**
 * uqr's module classification. Mirrors `QrCodeDataType` in the vendored code;
 * redeclared here so this module does not depend on importing an enum out of
 * a bundled file.
 */
const MODULE_BORDER = -1;
const MODULE_DATA = 0;

/**
 * Modules that carry payload or error-correction codewords — the only ones a
 * logo can cover and still be recoverable. Everything else (position, timing,
 * alignment, format information) is scaffolding the decoder needs before it
 * can read a single codeword.
 */
function isDataModule(type: number): boolean {
  return type === MODULE_DATA;
}

export interface EncodeOptions {
  ecc: EccLevel;
  context: PhysicalContext;
  /**
   * Logo width as a fraction of the symbol's width, 0–1. The logo is centred,
   * which is both the convention and the only placement that interleaving
   * spreads damage evenly across.
   */
  logoFraction?: number;
}

export interface EncodedResult {
  plan: QrPlan;
  diagnostics: Diagnostic[];
  budget: EccBudget | null;
}

/**
 * Coverage analysis for a centred square logo.
 *
 * Counted from the encoder's own type map rather than inferred from
 * coordinates — the alignment patterns move with the version, and hardcoding
 * where they sit is how a logo silently lands on one.
 */
export function analyseLogoCoverage(
  types: readonly (readonly number[])[],
  logoFraction: number
): { coveredDataModules: number; coveredFunctionModules: number } {
  if (logoFraction <= 0)
    return { coveredDataModules: 0, coveredFunctionModules: 0 };

  const size = types.length;
  const half = (size * Math.min(logoFraction, 1)) / 2;
  const centre = (size - 1) / 2;
  const from = Math.max(0, Math.ceil(centre - half));
  const to = Math.min(size - 1, Math.floor(centre + half));

  let coveredDataModules = 0;
  let coveredFunctionModules = 0;

  for (let y = from; y <= to; y++) {
    const row = types[y];
    if (!row) continue;
    for (let x = from; x <= to; x++) {
      const type = row[x];
      if (type === undefined || type === MODULE_BORDER) continue;
      if (isDataModule(type)) coveredDataModules++;
      else coveredFunctionModules++;
    }
  }

  return { coveredDataModules, coveredFunctionModules };
}

/**
 * Encode `text` and resolve everything that follows.
 *
 * `border: 0` is not cosmetic — uqr adds a one-module border by default, which
 * would make `size` disagree with the version's true module count and throw
 * off every physical measurement downstream. The quiet zone is added by the
 * renderer instead, at the four modules the standard requires, so it cannot be
 * accidentally omitted or accidentally doubled.
 */
export function encodePlan(
  text: string,
  options: EncodeOptions
): EncodedResult {
  const encoded = uqrEncode(text, {
    ecc: options.ecc,
    border: 0,
    // Never let the encoder silently raise the correction level to fill spare
    // capacity: the level is an input the person chose and the budget maths
    // is reported against it. A quietly different level makes those numbers
    // lies.
    boostEcc: false,
  });

  const expected = moduleCountForVersion(encoded.version);
  if (encoded.size !== expected) {
    throw new Error(
      `Encoder returned a ${encoded.size}-module symbol for version ${encoded.version}, expected ${expected}. The border option is probably no longer being honoured.`
    );
  }

  const matrix = encoded.data.map(row => row.slice());
  const geometry = resolveGeometry(encoded.version, options.context);

  const diagnostics: Diagnostic[] = [
    ...checkGeometry(geometry, options.context),
  ];

  let budget: EccBudget | null = null;
  const logoFraction = options.logoFraction ?? 0;

  if (logoFraction > 0) {
    const coverage = analyseLogoCoverage(encoded.types, logoFraction);
    budget = computeEccBudget(
      encoded.version,
      options.ecc,
      coverage.coveredDataModules
    );
    diagnostics.push(
      ...checkLogoPlacement(coverage.coveredFunctionModules),
      ...checkEccBudget(budget, true)
    );
  }

  return {
    plan: { text, version: encoded.version, ecc: options.ecc, matrix, geometry },
    diagnostics,
    budget,
  };
}
