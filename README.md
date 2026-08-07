# qrsmith

Build QR codes and know whether they will actually scan.

Generating the symbol is the easy part, and a dozen libraries do it. This one
exists for the two things that decide whether a printed code works and that
almost nothing surfaces: **payload formats have compatibility traps**, and
**a code has a physical size below which it stops being readable**.

Zero runtime dependencies. The encoder and decoder are vendored, not
installed — see [`vendor/README.md`](vendor/README.md).

---

## What it does that others don't

### Payload rules that are easy to get subtly wrong

- **Wi-Fi escaping in one pass.** The five reserved characters (`\ ; , : "`)
  must be escaped with the backslash handled *first*. Doing it as sequential
  replaces re-escapes the backslashes the earlier pass inserted, so `a;b`
  becomes `a\;b` and the scanner reads a literal backslash followed by a field
  terminator. A single character-class regex is immune, and there is a test
  asserting `\;` produces four characters.
- **`T:WPA` over `T:SAE`.** SAE looks like the right answer for WPA3 and fails
  silently on a great many scanners. iOS and most Android builds treat `T:WPA`
  as a wildcard and handshake on whatever the router offers, WPA3 included.
  For a network that refuses WPA2 outright, the encoding is `T:WPA;R:1`.
- **vCard 3.0, not 4.0.** 4.0 is the better document and its field mapping is
  inconsistent across Android contact apps. A card that imports with the phone
  number in the wrong slot is worse than an older version everything agrees on.
- **Alphanumeric mode is uppercase-only**, so uppercasing a URL's scheme and
  host can drop a whole version. Hosts and schemes are case-insensitive;
  **paths are not**, and are never touched. The saving is only offered when it
  actually materialises — one lowercase character in the path puts the whole
  string back into byte mode.

### Physical sizing, in millimetres

Two inputs decide it: how far away the code will be read from, and how it will
be produced. From those come the minimum width (the 10:1 rule), the module
size, the quiet zone and the export DPI.

The check that matters runs backwards. A payload dense enough to push the
version up produces modules too fine to print, at a width that looked
perfectly reasonable — which is why business-card vCards fail. `geometry.ts`
reports that with the numbers and the fix, not as "too small".

### Error correction as a budget you spend

The widespread advice is that level H tolerates 30% damage, therefore a logo
may cover 30%. Both halves mislead. Error correction is there to absorb the
world — glare, creases, ink spread, a thumb. A logo does not use spare
capacity, because there is none; it spends the capacity meant for all of that.

So `ecc.ts` reports **budget spent and margin remaining**, and gets two things
right that the folklore does not:

- **Correctable codewords are half the parity, not all of it.** Reed–Solomon
  needs two parity symbols per error at an unknown position, and a decoder has
  no idea where a logo is. Assuming otherwise overstates the budget by exactly
  2×.
- **Covering a function pattern is not a budget question.** Finder, timing and
  alignment patterns are how a decoder locates the symbol before it reads a
  single codeword. Error correction cannot recover them, so that is an outright
  error however much margin is left.

---

## Usage

```ts
import { buildPayload, encodePlan } from "qrsmith";

const { text, diagnostics } = buildPayload({
  kind: "wifi",
  ssid: 'Cafe Ravel; "Guest"',
  password: "flat-white-2026",
  security: "WPA",
  hidden: false,
  wpa3Only: false,
});
// text → WIFI:T:WPA;S:Cafe Ravel\; \"Guest\";P:flat-white-2026;;

const { plan, diagnostics: more } = encodePlan(text, {
  ecc: "M",
  context: { scanDistanceMm: 300, targetWidthMm: 45, process: "laser" },
});
// plan.version, plan.matrix, plan.geometry.moduleSizeMm, …
```

`rasterise(plan)` turns a plan into a raw RGBA buffer with no canvas, which is
what lets the round-trip tests run in plain Node.

v1 payload kinds: `url`, `text`, `wifi`, `vcard`, `email`, `sms`, `tel`.

---

## Diagnostic severity means one specific thing

| | |
|---|---|
| `error` | The artifact is broken. It will not reliably scan as configured, or it encodes something other than what was asked for. |
| `warning` | It scans now, and the margin is spent. It will fail conditions it will realistically meet. |
| `info` | It's fine. Here is a materially better option, or something true worth knowing. |

`code` values are the stable API and **never change meaning** — a new
situation gets a new code. `severity` is a judgement and may be re-tuned; see
[`CHANGELOG.md`](CHANGELOG.md).

Advice, however strongly held, is not an error.

---

## Tests

```bash
npm test        # node:test
npm run typecheck
```

The highest-value test is the property test in `test/roundtrip.test.ts`:
hundreds of randomly generated payloads across every type, drawn from an
alphabet weighted towards the characters that break things, each encoded,
rasterised, decoded and asserted byte-identical. Escaping bugs are caught as a
*class* rather than one fixture at a time.

It runs in plain Node with no browser, because the decoder takes a raw RGBA
buffer and `raster.ts` can synthesise one. That is why a pure-JS decoder was a
requirement rather than a preference.

---

## Before publishing to npm

`main`, `types` and `exports` all point at TypeScript source. That suits this
repository and any bundler, and **breaks consumers on older Node, CommonJS, or
any toolchain expecting JavaScript.** A build emitting `.js` + `.d.ts` has to
come first. `private: true` stays set until then, so `npm publish` refuses —
deliberately.

## Source of truth

This library is developed inside the
[praneeth.me website repository](https://github.com/praneeth-me/praneeth.me-website)
and mirrored out. **Do not commit here** — every publish replaces this
repository's history wholesale and the commit is destroyed.

## Licence

MIT. Vendored dependencies keep their own licences alongside them in
[`vendor/`](vendor/).
