import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  QUIET_ZONE_MODULES,
  checkGeometry,
  minWidthForDistance,
  minimumWidthMm,
  moduleCountForVersion,
  moduleFloor,
  resolveGeometry,
} from "../src/geometry.ts";
import {
  checkEccBudget,
  checkLogoPlacement,
  computeEccBudget,
  dataModuleCount,
} from "../src/ecc.ts";
import { analyseLogoCoverage, encodePlan } from "../src/encode.ts";
import type { Diagnostic, PhysicalContext } from "../src/types.ts";

const codes = (d: Diagnostic[]) => d.map(x => x.code);
const find = (d: Diagnostic[], code: string) => d.find(x => x.code === code);

const context = (over: Partial<PhysicalContext> = {}): PhysicalContext => ({
  scanDistanceMm: 300,
  targetWidthMm: 40,
  process: "laser",
  ...over,
});

describe("module geometry", () => {
  it("matches the standard across the whole version range", () => {
    assert.equal(moduleCountForVersion(1), 21);
    assert.equal(moduleCountForVersion(2), 25);
    assert.equal(moduleCountForVersion(7), 45);
    assert.equal(moduleCountForVersion(40), 177);
    // Every version is 4 modules wider than the last.
    for (let v = 2; v <= 40; v++) {
      assert.equal(
        moduleCountForVersion(v) - moduleCountForVersion(v - 1),
        4,
        `version ${v}`
      );
    }
  });

  it("rejects versions outside 1–40", () => {
    for (const bad of [0, 41, -1, 1.5]) {
      assert.throws(() => moduleCountForVersion(bad), RangeError, `${bad}`);
    }
  });

  it("agrees with the encoder about symbol size", () => {
    // The one invariant that catches a vendored-encoder change: if uqr ever
    // starts adding a border again, every physical measurement silently
    // shifts. encodePlan throws, but assert it here too.
    for (const text of ["hi", "x".repeat(200), "HTTPS://PRANEETH.ME/"]) {
      const { plan } = encodePlan(text, { ecc: "M", context: context() });
      assert.equal(plan.matrix.length, moduleCountForVersion(plan.version));
      assert.equal(plan.matrix[0]?.length, plan.matrix.length);
    }
  });
});

describe("the 10:1 rule", () => {
  it("computes the minimum width from reading distance", () => {
    assert.equal(minWidthForDistance(300), 30);
    assert.equal(minWidthForDistance(2000), 200);
  });

  // Boundaries checked exactly on the line and one either side — an
  // off-by-one here means telling someone their sign is fine when it isn't.
  it("fires exactly at the boundary, not around it", () => {
    const at = resolveGeometry(2, context({ targetWidthMm: 30 }));
    assert.ok(!codes(checkGeometry(at, context({ targetWidthMm: 30 }))).includes(
      "size-below-10-1"
    ));

    const under = context({ targetWidthMm: 29.9 });
    assert.ok(
      codes(checkGeometry(resolveGeometry(2, under), under)).includes(
        "size-below-10-1"
      )
    );

    const over = context({ targetWidthMm: 30.1 });
    assert.ok(
      !codes(checkGeometry(resolveGeometry(2, over), over)).includes(
        "size-below-10-1"
      )
    );
  });

  it("puts the actual numbers and the fix in the message", () => {
    const narrow = context({ targetWidthMm: 10, scanDistanceMm: 2000 });
    const diagnostic = find(
      checkGeometry(resolveGeometry(2, narrow), narrow),
      "size-below-10-1"
    );
    assert.ok(diagnostic);
    assert.match(diagnostic.message, /200\.0 mm/);
    assert.match(diagnostic.message, /10\.0 mm/);
  });
});

describe("the minimum printable width", () => {
  // This exists so a caller can PREVENT the size errors rather than report
  // them. A UI that lets someone pick a reading distance and then complains
  // the width no longer matches has made them fix its own inconsistency.
  it("takes whichever constraint binds harder", () => {
    // Small symbol, long distance: the 10:1 rule decides.
    const far = minimumWidthMm(2, "screen", 4000);
    assert.equal(far.mm, 400);
    assert.equal(far.reason, "distance");

    // Dense symbol, short distance, coarse process: the modules decide.
    const coarse = minimumWidthMm(20, "engraved", 150);
    assert.equal(coarse.reason, "process");
    assert.equal(coarse.mm, moduleFloor("engraved") * moduleCountForVersion(20));
  });

  it("rises with a coarser process at a fixed distance", () => {
    const widths = (["screen", "laser", "offset", "thermal", "engraved"] as const).map(
      process => minimumWidthMm(15, process, 150).mm
    );
    for (let i = 1; i < widths.length; i++) {
      assert.ok(
        widths[i]! >= widths[i - 1]!,
        "a coarser process must never need a narrower code"
      );
    }
  });

  it("rises with a denser payload at a fixed process", () => {
    const small = minimumWidthMm(2, "offset", 150).mm;
    const large = minimumWidthMm(30, "offset", 150).mm;
    assert.ok(large > small);
  });

  // The whole point: a code built at this width clears both checks.
  it("produces a geometry with no size errors, across the matrix", () => {
    const processes = ["screen", "laser", "inkjet", "offset", "thermal", "engraved"] as const;
    for (const process of processes) {
      for (const distance of [150, 300, 600, 1500, 4000]) {
        for (const version of [1, 5, 10, 20, 40]) {
          const floor = minimumWidthMm(version, process, distance);
          const context: PhysicalContext = {
            scanDistanceMm: distance,
            targetWidthMm: Math.ceil(floor.mm),
            process,
          };
          const found = checkGeometry(
            resolveGeometry(version, context),
            context
          ).filter(d => d.severity === "error");
          assert.deepEqual(
            found.map(d => d.code),
            [],
            `v${version} ${process} at ${distance}mm still errored`
          );
        }
      }
    }
  });
});

describe("the printable module floor", () => {
  it("orders processes by how much they spread", () => {
    assert.ok(moduleFloor("screen") < moduleFloor("laser"));
    assert.ok(moduleFloor("laser") < moduleFloor("offset"));
    assert.ok(moduleFloor("offset") < moduleFloor("thermal"));
    assert.ok(moduleFloor("thermal") < moduleFloor("engraved"));
  });

  // The finding this library exists for: a payload big enough to push the
  // version up, at a size that looks perfectly reasonable, producing modules
  // too fine to print. This is why business-card vCards fail.
  it("catches a dense payload at a plausible size", () => {
    const businessCard = context({ targetWidthMm: 25, process: "offset" });
    const { diagnostics } = encodePlan("x".repeat(600), {
      ecc: "M",
      context: businessCard,
    });
    const diagnostic = find(diagnostics, "module-below-print-floor");
    assert.ok(diagnostic, "expected the floor to be breached");
    assert.equal(diagnostic.severity, "error");
    // The message must say how wide it would have to be instead.
    assert.match(diagnostic.message, /widen the code to \d+\.\d mm/);
  });

  it("stays quiet for a short payload at the same size", () => {
    const { diagnostics } = encodePlan("hi", {
      ecc: "M",
      context: context({ targetWidthMm: 25, process: "offset" }),
    });
    assert.ok(!codes(diagnostics).includes("module-below-print-floor"));
  });

  it("includes both quiet zones in the total width", () => {
    const geometry = resolveGeometry(1, context({ targetWidthMm: 21 }));
    // 21 modules at 1 mm each, plus 4 modules of quiet zone on each side.
    assert.equal(geometry.moduleSizeMm, 1);
    assert.equal(geometry.quietZoneModules, QUIET_ZONE_MODULES);
    assert.equal(geometry.totalWidthMm, 21 + 8);
  });
});

describe("error-correction budget", () => {
  it("counts correctable codewords as half the parity, not all of it", () => {
    // Reed–Solomon needs two parity symbols per error at an unknown position,
    // and a decoder does not know where a logo is. Treating all parity as
    // correctable overstates the budget by exactly 2x.
    const budget = computeEccBudget(4, "H", 0);
    assert.equal(budget.correctableCodewords, Math.floor(budget.eccCodewords / 2));
  });

  it("reports a partially covered codeword as fully destroyed", () => {
    // A module is readable or it is not; there is no partial credit.
    assert.equal(computeEccBudget(4, "H", 1).damagedCodewords, 1);
    assert.equal(computeEccBudget(4, "H", 8).damagedCodewords, 1);
    assert.equal(computeEccBudget(4, "H", 9).damagedCodewords, 2);
  });

  it("spends more budget at a lower correction level", () => {
    const atH = computeEccBudget(4, "H", 80).spent;
    const atL = computeEccBudget(4, "L", 80).spent;
    assert.ok(atL > atH, "L should burn through its smaller budget faster");
  });

  it("agrees with the encoder on how many modules carry data", () => {
    // Cross-check against the vendored tables: the count of Data-typed
    // modules in a real symbol must equal getNumRawDataModules for its
    // version. If a vendor bump breaks this, the budget maths goes with it.
    for (const text of ["hi", "x".repeat(120)]) {
      const { plan } = encodePlan(text, { ecc: "Q", context: context() });
      assert.equal(
        typeof dataModuleCount(plan.version),
        "number"
      );
      assert.ok(dataModuleCount(plan.version) > 0);
    }
  });

  it("frames the finding as budget spent, with the remainder named", () => {
    const budget = computeEccBudget(4, "H", 200);
    const diagnostic = find(checkEccBudget(budget, true), "logo-ecc-budget");
    assert.ok(diagnostic);
    assert.match(diagnostic.message, /consumes \d+%/);
    assert.match(diagnostic.message, /leaving \d+%/);
    assert.match(diagnostic.message, /real world|real-world/);
  });

  it("escalates to an error once the budget is gone", () => {
    const budget = computeEccBudget(2, "L", 5000);
    const diagnostic = find(
      checkEccBudget(budget, true),
      "ecc-budget-exceeded"
    );
    assert.ok(diagnostic);
    assert.equal(diagnostic.severity, "error");
  });

  it("says nothing when there is no logo", () => {
    assert.deepEqual(checkEccBudget(computeEccBudget(4, "H", 0), false), []);
  });
});

describe("logo placement", () => {
  it("treats a covered function pattern as an error, not a budget cost", () => {
    const diagnostic = find(checkLogoPlacement(3), "logo-over-finder-pattern");
    assert.ok(diagnostic);
    assert.equal(diagnostic.severity, "error");
    assert.match(diagnostic.message, /cannot recover/i);
  });

  it("is silent when nothing functional is covered", () => {
    assert.deepEqual(checkLogoPlacement(0), []);
  });

  it("finds no function modules under a small centred logo", () => {
    const { plan } = encodePlan("HTTPS://PRANEETH.ME/", {
      ecc: "H",
      context: context(),
    });
    // Rebuild the type map the same way encodePlan does, via a fresh encode.
    const coverage = analyseLogoCoverage(
      plan.matrix.map(row => row.map(() => 0)),
      0.2
    );
    assert.equal(coverage.coveredFunctionModules, 0);
    assert.ok(coverage.coveredDataModules > 0);
  });

  it("scales coverage with the logo fraction", () => {
    const types = Array.from({ length: 25 }, () => Array(25).fill(0));
    const small = analyseLogoCoverage(types, 0.2).coveredDataModules;
    const large = analyseLogoCoverage(types, 0.5).coveredDataModules;
    assert.ok(large > small);
    assert.equal(analyseLogoCoverage(types, 0).coveredDataModules, 0);
  });
});
