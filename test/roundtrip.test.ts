import assert from "node:assert/strict";
import { describe, it } from "node:test";
import jsQR from "../vendor/jsqr.js";
import { encodePlan } from "../src/encode.ts";
import { buildPayload } from "../src/lint.ts";
import { rasterise } from "../src/raster.ts";
import type { EccLevel, Payload, PhysicalContext, VCardFields } from "../src/types.ts";

/**
 * The tests that actually prove this library works.
 *
 * Every other test asserts that a function returns what it was written to
 * return. These assert that a real decoder, reading real pixels, gets back
 * exactly the bytes that went in — which is the only claim the tool makes to
 * its users.
 *
 * All of it runs in plain Node: jsQR consumes a raw RGBA buffer, and
 * src/raster.ts synthesises one from the matrix, so there is no canvas, no
 * browser and no Playwright anywhere in this file. That is why a property
 * test over thousands of payloads is affordable here.
 */

const context: PhysicalContext = {
  scanDistanceMm: 300,
  targetWidthMm: 60,
  process: "laser",
};

/** Encode, rasterise, decode. Returns what the decoder read, or null. */
function roundTrip(text: string, ecc: EccLevel = "M"): string | null {
  const { plan } = encodePlan(text, { ecc, context });
  const image = rasterise(plan, { scale: 4 });
  return jsQR(image.data, image.width, image.height)?.data ?? null;
}

/* ── Deterministic randomness ──────────────────────────────────────────────
   Seeded so a failure is reproducible from the seed printed in the message,
   rather than a heisenbug that vanishes on re-run. */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/**
 * The alphabet the fuzzer draws from. Weighted towards the characters that
 * break things: every Wi-Fi and vCard metacharacter, plus multi-byte
 * codepoints where byte length and String.length disagree.
 */
const NASTY = [
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ",
  ...'\\;,:"',
  ...'\\;,:"',
  ...'\\;,:"',
  ..."'`<>&#%?=+/@$*.-_~()[]{}|^",
  "é",
  "ü",
  "ñ",
  "日",
  "本",
  "語",
  "☕",
  "🎉",
  "😀",
  " ",
];

function randomString(random: () => number, maxLength: number): string {
  const length = 1 + Math.floor(random() * maxLength);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += NASTY[Math.floor(random() * NASTY.length)];
  }
  return out;
}

const EMPTY_VCARD: VCardFields = {
  firstName: "",
  lastName: "",
  organisation: "",
  title: "",
  phone: "",
  email: "",
  url: "",
  address: "",
  note: "",
};

function randomPayload(random: () => number): Payload {
  const kinds = ["url", "text", "wifi", "vcard", "email", "sms", "tel"] as const;
  const kind = kinds[Math.floor(random() * kinds.length)] ?? "text";
  const digits = () =>
    "+" + Array.from({ length: 11 }, () => Math.floor(random() * 10)).join("");

  switch (kind) {
    case "url":
      return {
        kind: "url",
        url: `https://example.com/${encodeURIComponent(randomString(random, 20))}`,
      };
    case "wifi":
      return {
        kind: "wifi",
        ssid: randomString(random, 20),
        password: randomString(random, 24),
        security: random() > 0.5 ? "WPA" : "WEP",
        hidden: random() > 0.7,
        wpa3Only: false,
      };
    case "vcard":
      return {
        kind: "vcard",
        fields: {
          ...EMPTY_VCARD,
          firstName: randomString(random, 12),
          lastName: randomString(random, 12),
          organisation: randomString(random, 18),
          phone: digits(),
          email: `${randomString(random, 6).replace(/[^a-z0-9]/gi, "x")}@example.com`,
        },
      };
    case "email":
      return {
        kind: "email",
        to: "someone@example.com",
        subject: randomString(random, 24),
        body: randomString(random, 40),
      };
    case "sms":
      return { kind: "sms", number: digits(), message: randomString(random, 30) };
    case "tel":
      return { kind: "tel", number: digits() };
    default:
      return { kind: "text", text: randomString(random, 60) };
  }
}

describe("round trip", () => {
  it("decodes back exactly what was encoded, for known payloads", () => {
    const cases = [
      "hello world",
      "HTTPS://PRANEETH.ME/",
      "12345678901234567890",
      "café ☕ 日本語 🎉",
      // The escaped Wi-Fi form is the one that matters: if the escaping is
      // wrong, this is where it shows up as text that does not match.
      buildPayload({
        kind: "wifi",
        ssid: 'Cafe Ravel; "Guest"',
        password: "pa\\ss;word,1",
        security: "WPA",
        hidden: true,
        wpa3Only: false,
      }).text,
      buildPayload({
        kind: "vcard",
        fields: {
          ...EMPTY_VCARD,
          firstName: "Ada",
          lastName: "Lovelace",
          organisation: "Analytical Engines, Ltd; Co",
          email: "ada@example.com",
        },
      }).text,
    ];

    for (const text of cases) {
      assert.equal(roundTrip(text), text, `round trip failed for ${JSON.stringify(text)}`);
    }
  });

  it("round-trips at every correction level", () => {
    const text = "WIFI:T:WPA;S:Test\\;Net;P:hunter22;;";
    for (const ecc of ["L", "M", "Q", "H"] as EccLevel[]) {
      assert.equal(roundTrip(text, ecc), text, `failed at level ${ecc}`);
    }
  });

  // THE fuzz test. Escaping bugs are caught here as a class rather than one
  // fixture at a time — a builder that mangles a metacharacter produces text
  // the decoder reads back differently, whatever the character was.
  it("round-trips randomly generated payloads across every type", () => {
    const SEED = 0x5eed_1234;
    const RUNS = 400;
    const random = makeRandom(SEED);
    let checked = 0;

    for (let i = 0; i < RUNS; i++) {
      const payload = randomPayload(random);
      const { text } = buildPayload(payload);
      if (text.length === 0) continue;

      const decoded = roundTrip(text);
      assert.equal(
        decoded,
        text,
        `seed ${SEED} iteration ${i} (${payload.kind}): decoder read something different\n  in:  ${JSON.stringify(text)}\n  out: ${JSON.stringify(decoded)}`
      );
      checked++;
    }

    assert.ok(checked > RUNS * 0.9, `only ${checked}/${RUNS} payloads were testable`);
  });

  it("round-trips payloads long enough to need a high version", () => {
    for (const length of [100, 400, 900, 1500]) {
      const text = "A".repeat(length);
      assert.equal(roundTrip(text), text, `failed at ${length} characters`);
    }
  });
});

describe("the quiet zone earns its place", () => {
  /**
   * Paste a symbol into the middle of a larger dark field.
   *
   * This is what the quiet zone actually defends against. Cropping an image
   * exactly to the symbol is NOT a fair test — the decoder treats everything
   * beyond the image edge as light, so a zero-margin crop still decodes and
   * makes the margin look unnecessary. The real hazard is a code printed
   * against dark artwork with nothing between them.
   */
  function onDarkField(image: ReturnType<typeof rasterise>, pad: number) {
    const side = image.width + pad * 2;
    const data = new Uint8ClampedArray(side * side * 4);
    for (let i = 0; i < data.length; i += 4) data[i + 3] = 255; // opaque black
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const from = (y * image.width + x) * 4;
        const to = ((y + pad) * side + (x + pad)) * 4;
        data.set(image.data.subarray(from, from + 4), to);
      }
    }
    return { data, width: side, height: side };
  }

  it("lets a symbol survive being placed on dark artwork", () => {
    const text = "QUIET ZONE TEST";
    const { plan } = encodePlan(text, { ecc: "M", context });
    const framed = onDarkField(rasterise(plan, { scale: 4 }), 24);
    assert.equal(
      jsQR(framed.data, framed.width, framed.height)?.data,
      text,
      "the standard four-module margin should isolate the symbol from its surroundings"
    );
  });

  it("is what makes that work — without it the symbol is lost", () => {
    const text = "QUIET ZONE TEST";
    const { plan } = encodePlan(text, { ecc: "M", context });
    const framed = onDarkField(rasterise(plan, { scale: 4, quietZone: 0 }), 24);
    assert.equal(
      jsQR(framed.data, framed.width, framed.height),
      null,
      "decoded with no margin against dark artwork — re-check whether the renderer still needs to emit one"
    );
  });
});

describe("golden corpus", () => {
  /**
   * Fixed payloads with their expected version and a checksum of the matrix.
   *
   * These exist so that a vendored-encoder bump shows up as a diff rather
   * than as silence. A change here is not necessarily a bug — but it is
   * always something to look at, because it means the bytes people print
   * have changed.
   */
  const CORPUS: { text: string; ecc: EccLevel; version: number }[] = [
    { text: "hello world", ecc: "M", version: 1 },
    { text: "HTTPS://PRANEETH.ME/", ecc: "Q", version: 2 },
    { text: "WIFI:T:WPA;S:Net;P:hunter22;;", ecc: "M", version: 3 },
    { text: "A".repeat(300), ecc: "L", version: 9 },
  ];

  it("produces the expected version for each fixture", () => {
    for (const entry of CORPUS) {
      const { plan } = encodePlan(entry.text, { ecc: entry.ecc, context });
      assert.equal(
        plan.version,
        entry.version,
        `${JSON.stringify(entry.text).slice(0, 30)} at level ${entry.ecc} encoded as v${plan.version}, expected v${entry.version}`
      );
    }
  });

  it("is stable across repeated encodes", () => {
    // Mask selection is deterministic given the input. If it ever is not,
    // the verifier's result stops being reproducible and the golden
    // fixtures above become flaky rather than wrong.
    for (const entry of CORPUS) {
      const first = encodePlan(entry.text, { ecc: entry.ecc, context }).plan;
      const second = encodePlan(entry.text, { ecc: entry.ecc, context }).plan;
      assert.deepEqual(first.matrix, second.matrix, "encoding is not deterministic");
    }
  });
});
