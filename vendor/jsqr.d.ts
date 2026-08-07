// Hand-written declarations for the vendored jsQR bundle. Upstream ships
// per-module .d.ts files that describe its unbundled source tree, which does
// not match the single-file bundle we vendor — so this describes only the
// surface we actually call.

export interface QRCodeLocation {
  topRightCorner: { x: number; y: number };
  topLeftCorner: { x: number; y: number };
  bottomRightCorner: { x: number; y: number };
  bottomLeftCorner: { x: number; y: number };
}

export interface QRCode {
  /** The decoded payload. This is the value the verifier compares against
   * the input — a decode that returns different text is a failure. */
  data: string;
  binaryData: number[];
  location: QRCodeLocation;
  version: number;
}

export interface JsQrOptions {
  /** Whether to also try the inverted image. "attemptBoth" is the default
   * upstream; the verifier pins this deliberately — see verify.worker.ts. */
  inversionAttempts?:
    | "dontInvert"
    | "onlyInvert"
    | "attemptBoth"
    | "invertFirst";
}

declare function jsQR(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: JsQrOptions
): QRCode | null;

export default jsQR;
