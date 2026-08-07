import type { Diagnostic, EccLevel } from "./types.ts";
import { error, info, warning } from "./payload/diagnostics.ts";
import {
  ECC_CODEWORDS_PER_BLOCK,
  NUM_ERROR_CORRECTION_BLOCKS,
  getNumRawDataModules,
} from "../vendor/uqr.mjs";

/**
 * Error-correction accounting.
 *
 * THE FRAMING IS THE POINT. The advice repeated across the web is that level H
 * tolerates 30% damage, therefore a logo may cover 30%. Both halves mislead.
 *
 * Error correction exists to absorb *the world* — glare, creases, ink spread,
 * a thumb, a scuffed table tent. A logo does not use spare capacity, because
 * there is no spare capacity: it spends the capacity that was there for all of
 * that. So the number worth reporting is not "how much can I cover" but "how
 * much of my margin have I already spent, and what is left for reality".
 *
 * Everything below is expressed that way.
 */

/** Index into uqr's ECC tables. Order is fixed by the specification. */
const ECC_TABLE_INDEX: Record<EccLevel, number> = { L: 0, M: 1, Q: 2, H: 3 };

/** Nominal recoverable fraction, for display only — never used in the maths
 * below, which works in codewords. */
export const ECC_NOMINAL_FRACTION: Record<EccLevel, number> = {
  L: 0.07,
  M: 0.15,
  Q: 0.25,
  H: 0.3,
};

export const ECC_LABELS: Record<EccLevel, string> = {
  L: "L — lowest, largest payload",
  M: "M — balanced",
  Q: "Q — resilient",
  H: "H — highest, for logos and rough conditions",
};

export interface EccBudget {
  /** Codewords of error correction the symbol carries in total. */
  eccCodewords: number;
  /**
   * Codewords that can actually be *corrected*.
   *
   * Reed–Solomon needs two parity symbols per corrected error whose position
   * is unknown. A decoder has no idea where a logo is — it is not an erasure
   * with a known location, just wrong data — so the correctable count is half
   * the parity, not all of it. Assuming otherwise overstates the budget by
   * exactly 2x, which is the difference between advice that works and advice
   * that gets codes rejected at the door.
   */
  correctableCodewords: number;
  /** Codewords destroyed by whatever is covering the symbol. */
  damagedCodewords: number;
  /** Fraction of the correctable budget consumed. Can exceed 1. */
  spent: number;
  /** Fraction left for real-world damage. Floors at 0. */
  remaining: number;
}

/**
 * How much of the correction budget a given number of covered modules costs.
 *
 * `coveredDataModules` must count only modules carrying data or ECC — function
 * patterns are not recoverable at all and are handled separately by
 * `checkLogoPlacement`.
 *
 * A note on precision: this treats damage as evenly spread across blocks.
 * That is close to true and not a convenient simplification — QR interleaves
 * codewords across blocks specifically so that a burst of damage in one region
 * is distributed evenly rather than destroying one block outright. A centred
 * logo is exactly the case interleaving was designed for.
 */
export function computeEccBudget(
  version: number,
  ecc: EccLevel,
  coveredDataModules: number
): EccBudget {
  const index = ECC_TABLE_INDEX[ecc];
  const perBlock = ECC_CODEWORDS_PER_BLOCK[index]?.[version];
  const blocks = NUM_ERROR_CORRECTION_BLOCKS[index]?.[version];

  if (perBlock === undefined || blocks === undefined) {
    throw new RangeError(`No ECC table entry for version ${version}, level ${ecc}`);
  }

  const eccCodewords = perBlock * blocks;
  const correctableCodewords = Math.floor(eccCodewords / 2);

  // A codeword is eight modules. Partial coverage still destroys the codeword,
  // so this rounds up — a module is either readable or it is not.
  const damagedCodewords = Math.ceil(coveredDataModules / 8);

  const spent =
    correctableCodewords === 0 ? 0 : damagedCodewords / correctableCodewords;

  return {
    eccCodewords,
    correctableCodewords,
    damagedCodewords,
    spent,
    remaining: Math.max(0, 1 - spent),
  };
}

/** Total modules a version devotes to data and ECC, i.e. everything a logo
 * could cover without destroying a function pattern. */
export function dataModuleCount(version: number): number {
  return getNumRawDataModules(version);
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/**
 * Report the budget as spent-and-remaining, with thresholds chosen for what
 * actually happens rather than for round numbers.
 */
export function checkEccBudget(budget: EccBudget, hasLogo: boolean): Diagnostic[] {
  if (!hasLogo || budget.damagedCodewords === 0) return [];

  if (budget.spent >= 1) {
    return [
      error(
        "ecc-budget-exceeded",
        "logo",
        `This logo destroys ${budget.damagedCodewords} codewords against a correctable budget of ${budget.correctableCodewords} — more damage than the code can repair, before it meets a single real-world scuff. It will not scan reliably. Shrink the logo or raise the correction level.`
      ),
    ];
  }

  if (budget.spent > 0.6) {
    return [
      warning(
        "logo-ecc-budget",
        "logo",
        `This logo consumes ${percent(budget.spent)} of the error-correction budget, leaving ${percent(budget.remaining)} for the real world — glare, creases, ink spread, a thumb over the corner. It decodes in perfect conditions and has little margin beyond them. Shrinking the logo or moving to level H recovers it.`
      ),
    ];
  }

  return [
    info(
      "logo-ecc-budget",
      "logo",
      `This logo consumes ${percent(budget.spent)} of the error-correction budget, leaving ${percent(budget.remaining)} for real-world damage. That is a comfortable margin.`
    ),
  ];
}

/**
 * Function patterns are not a budget question.
 *
 * Finder, timing and alignment patterns are how a decoder locates and squares
 * up the symbol in the first place. Error correction protects the *payload*;
 * it cannot recover the scaffolding used to find the payload. Covering any of
 * them is an outright error however much correction is left.
 *
 * @param coveredFunctionModules modules of type Position, Timing or Alignment
 *        that fall under the logo, counted from the encoder's own type map
 *        rather than guessed from coordinates.
 */
export function checkLogoPlacement(
  coveredFunctionModules: number
): Diagnostic[] {
  if (coveredFunctionModules === 0) return [];
  return [
    error(
      "logo-over-finder-pattern",
      "logo",
      `The logo covers ${coveredFunctionModules} module${coveredFunctionModules === 1 ? "" : "s"} of the finder, timing or alignment patterns. Error correction cannot recover these — they are how a scanner locates the code at all, before it reads anything. Move the logo to the centre or make it smaller.`
    ),
  ];
}
