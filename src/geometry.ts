import type {
  Diagnostic,
  Geometry,
  PhysicalContext,
  PrintProcess,
} from "./types.ts";
import { error, info, warning } from "./payload/diagnostics.ts";

/**
 * Physical sizing — the half of this library that answers the question no
 * other generator answers: how big do I print this, and will it still read?
 *
 * Everything here is millimetres. Pixels are a rendering detail that only
 * appears at the very end, in `requiredDpi`.
 */

/** ISO/IEC 18004 requires four modules of clear space on every side. */
export const QUIET_ZONE_MODULES = 4;

/**
 * The 10:1 rule: a symbol needs to be about one tenth as wide as the distance
 * it is read from. It is a rule of thumb rather than a clause in the standard,
 * but it matches what camera autofocus and sensor resolution actually manage
 * and every practical sizing guide converges on it.
 */
export const SCAN_DISTANCE_RATIO = 10;

/**
 * Smallest module that survives each production process, in millimetres.
 *
 * These are not arbitrary. The floor is set by how much a dark module spreads
 * into its neighbours — ink bleed, toner scatter, thermal blooming, laser kerf
 * — because once spread approaches half a module the scanner can no longer
 * tell where the boundary was.
 *
 * The reference point: at 300 dpi with four printer dots to a module, a module
 * is 0.34 mm, which is the commonly cited practical floor for digital print.
 * Offset is given more room for dot gain and registration error; thermal label
 * printers and engraving more again. Screen has no ink, so it is limited only
 * by pixel density.
 *
 * Tunable — these are engineering judgements, not constants from the standard,
 * which is why they live in one documented table rather than scattered as
 * magic numbers.
 */
const MODULE_FLOOR_MM: Record<PrintProcess, number> = {
  screen: 0.2,
  laser: 0.3,
  inkjet: 0.35,
  offset: 0.4,
  thermal: 0.5,
  engraved: 0.6,
};

export const PRINT_PROCESS_LABELS: Record<PrintProcess, string> = {
  screen: "On a screen",
  laser: "Laser / digital print",
  inkjet: "Inkjet",
  offset: "Offset press",
  thermal: "Thermal label printer",
  engraved: "Engraved or etched",
};

/**
 * Device pixels per module needed for a clean raster export. Below about four,
 * anti-aliasing on the module edges starts to matter more than the modules.
 */
const PIXELS_PER_MODULE = 4;

const MM_PER_INCH = 25.4;

/** Modules per side for a version, excluding the quiet zone. */
export function moduleCountForVersion(version: number): number {
  if (!Number.isInteger(version) || version < 1 || version > 40) {
    throw new RangeError(`QR version must be 1–40, got ${version}`);
  }
  return 21 + 4 * (version - 1);
}

/** Minimum overall width for a given reading distance, via the 10:1 rule. */
export function minWidthForDistance(scanDistanceMm: number): number {
  return scanDistanceMm / SCAN_DISTANCE_RATIO;
}

/** The floor for a process. Exported so the UI can show the target to beat. */
export function moduleFloor(process: PrintProcess): number {
  return MODULE_FLOOR_MM[process];
}

/** Why a symbol cannot be printed any narrower than it can. */
export type WidthFloorReason = "distance" | "process";

export interface WidthFloor {
  /** The smallest width, in millimetres, that satisfies every constraint. */
  mm: number;
  /** Which constraint is currently binding. */
  reason: WidthFloorReason;
  /** The 10:1 minimum on its own. */
  distanceMm: number;
  /** The width at which modules reach this process's floor, on its own. */
  processMm: number;
}

/**
 * The narrowest this symbol can usefully be printed.
 *
 * Two independent constraints, whichever bites harder:
 *
 *  - **Reading distance.** The 10:1 rule. A choice about the world.
 *  - **The production process.** Modules cannot go below the size the
 *    process can hold, and how many modules there are is decided by the
 *    payload. A longer payload therefore raises this floor.
 *
 * Exposed as a function rather than left implicit in the diagnostics because
 * a caller should be able to *prevent* the problem instead of reporting it.
 * A UI that lets someone pick a reading distance and then complains that the
 * width no longer matches has made them fix an inconsistency it created
 * itself; one that moves the floor has not.
 */
export function minimumWidthMm(
  version: number,
  process: PrintProcess,
  scanDistanceMm: number
): WidthFloor {
  const distanceMm = minWidthForDistance(scanDistanceMm);
  const processMm = MODULE_FLOOR_MM[process] * moduleCountForVersion(version);
  return {
    mm: Math.max(distanceMm, processMm),
    reason: processMm > distanceMm ? "process" : "distance",
    distanceMm,
    processMm,
  };
}

/**
 * Resolve every physical measurement for a symbol at a requested size.
 *
 * `targetWidthMm` is the symbol itself, excluding the quiet zone — that is
 * what people measure when they draw a box in a layout. `totalWidthMm` adds
 * the quiet zone back, and is what actually has to fit on the page.
 */
export function resolveGeometry(
  version: number,
  context: PhysicalContext
): Geometry {
  const moduleCount = moduleCountForVersion(version);
  const moduleSizeMm = context.targetWidthMm / moduleCount;
  const quietZoneMm = moduleSizeMm * QUIET_ZONE_MODULES;

  return {
    moduleCount,
    quietZoneModules: QUIET_ZONE_MODULES,
    moduleSizeMm,
    moduleFloorMm: MODULE_FLOOR_MM[context.process],
    minWidthMm: minWidthForDistance(context.scanDistanceMm),
    totalWidthMm: context.targetWidthMm + quietZoneMm * 2,
    requiredDpi: Math.ceil((PIXELS_PER_MODULE / moduleSizeMm) * MM_PER_INCH),
  };
}

/** One decimal place, for messages. Physical measurements to three decimals
 * read as false precision. */
const mm = (value: number) => `${value.toFixed(1)} mm`;

/**
 * Check a resolved geometry and say what is wrong in terms of the numbers
 * that decide it. Every message carries the actual figure and the fix —
 * "2.1 mm short at 30 cm, widen to 30 mm" is actionable in a way that
 * "too small" is not.
 */
export function checkGeometry(
  geometry: Geometry,
  context: PhysicalContext
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (context.targetWidthMm < geometry.minWidthMm) {
    const shortfall = geometry.minWidthMm - context.targetWidthMm;
    diagnostics.push(
      error(
        "size-below-10-1",
        "size",
        `At ${mm(context.targetWidthMm)} this is ${mm(shortfall)} narrower than the ${mm(geometry.minWidthMm)} a code needs to be read from ${mm(context.scanDistanceMm)} away. Widen it to ${mm(geometry.minWidthMm)}, or expect people to step closer.`
      )
    );
  }

  // The floor check is what catches the real failure: a payload that pushed
  // the version up until the modules became too fine to print, at a size that
  // looked perfectly reasonable.
  if (geometry.moduleSizeMm < geometry.moduleFloorMm) {
    const widthAtFloor = geometry.moduleFloorMm * geometry.moduleCount;
    diagnostics.push(
      error(
        "module-below-print-floor",
        "size",
        `Each module lands at ${geometry.moduleSizeMm.toFixed(2)} mm, below the ${geometry.moduleFloorMm} mm this process can hold — ink spread will close the gaps between them. Either widen the code to ${mm(widthAtFloor)}, shorten the payload so it needs fewer modules, or choose a finer process.`
      )
    );
  }

  if (geometry.requiredDpi > 1200) {
    diagnostics.push(
      warning(
        "dpi-insufficient",
        "size",
        `Rendering this cleanly needs ${geometry.requiredDpi} dpi, past what most printers resolve. The modules are very fine for the chosen size.`
      )
    );
  }

  // Comfortably clear of both floors is worth saying: it is the reassurance
  // that lets someone stop worrying and print the thing.
  if (
    geometry.moduleSizeMm >= geometry.moduleFloorMm * 1.5 &&
    context.targetWidthMm >= geometry.minWidthMm
  ) {
    diagnostics.push(
      info(
        "size-comfortable",
        "size",
        `${mm(context.targetWidthMm)} at ${geometry.moduleSizeMm.toFixed(2)} mm per module — comfortably above the ${geometry.moduleFloorMm} mm floor for this process. Allow ${mm(geometry.totalWidthMm)} of total space including the quiet zone.`
      )
    );
  }

  return diagnostics;
}
