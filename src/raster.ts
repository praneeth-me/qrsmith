import { QUIET_ZONE_MODULES } from "./geometry.ts";
import type { QrPlan } from "./types.ts";

/**
 * Matrix to a raw RGBA buffer, with no canvas involved.
 *
 * This exists so the encode → rasterise → decode round trip can run in plain
 * Node. jsQR takes a `Uint8ClampedArray` of RGBA and nothing else — no
 * `ImageData`, no DOM — so synthesising the buffer here means the property
 * test that actually proves correctness needs no browser, no Playwright and
 * no headless Chromium. It runs in milliseconds as part of `npm run test:lib`.
 *
 * That is the whole reason a pure-JS decoder was a hard requirement rather
 * than a preference.
 *
 * The browser preview does not use this — it draws to a real canvas so that
 * module styles, colours and the logo are all included. Both paths are
 * verified: this one by the property test, the canvas one by Playwright
 * re-decoding the exported file.
 */

export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface RasterOptions {
  /** Device pixels per module. */
  scale?: number;
  /** Quiet zone in modules. Defaults to the four the standard requires;
   * settable so a test can prove that removing it breaks decoding. */
  quietZone?: number;
  /** Dark module colour as [r,g,b]. Defaults to black. */
  foreground?: [number, number, number];
  /** Light module colour as [r,g,b]. Defaults to white. */
  background?: [number, number, number];
}

/**
 * Render a plan's matrix into an RGBA buffer.
 *
 * Deliberately plain: square modules, no anti-aliasing, exact pixel
 * boundaries. The point is to test the *encoding*, so the rendering must not
 * introduce failures of its own — anti-aliased edges would test the decoder's
 * thresholding rather than the matrix.
 */
export function rasterise(plan: QrPlan, options: RasterOptions = {}): RgbaImage {
  const scale = Math.max(1, Math.floor(options.scale ?? 4));
  const quiet = options.quietZone ?? QUIET_ZONE_MODULES;
  const [fr, fg, fb] = options.foreground ?? [0, 0, 0];
  const [br, bg, bb] = options.background ?? [255, 255, 255];

  const modules = plan.matrix.length;
  const side = (modules + quiet * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4);

  // Fill with the background first, then stamp dark modules over it — fewer
  // branches than deciding per pixel, and the quiet zone comes free.
  for (let i = 0; i < data.length; i += 4) {
    data[i] = br;
    data[i + 1] = bg;
    data[i + 2] = bb;
    data[i + 3] = 255;
  }

  for (let my = 0; my < modules; my++) {
    const row = plan.matrix[my];
    if (!row) continue;
    for (let mx = 0; mx < modules; mx++) {
      if (!row[mx]) continue;
      const x0 = (mx + quiet) * scale;
      const y0 = (my + quiet) * scale;
      for (let y = y0; y < y0 + scale; y++) {
        let offset = (y * side + x0) * 4;
        for (let x = 0; x < scale; x++) {
          data[offset] = fr;
          data[offset + 1] = fg;
          data[offset + 2] = fb;
          data[offset + 3] = 255;
          offset += 4;
        }
      }
    }
  }

  return { data, width: side, height: side };
}
