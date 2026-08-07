# vendor/

Third-party code, copied in rather than installed.

## Why vendored

`qrsmith` declares **no runtime dependencies**. The code below is committed to
this repository instead, which means:

- Nothing an `npm install` does can substitute it. Supply-chain compromise of a
  transitive dependency is the realistic attack against a package like this,
  and there is no dependency tree here to compromise.
- It can be read. Both files below are unminified and were reviewed before
  being committed.
- Updating is a deliberate act with a reviewable diff, not a lockfile bump.

Both are permissively licensed and their licence files are kept alongside them.
This is explicitly allowed; the licences are reproduced, not stripped.

## Contents

### `uqr.mjs` / `uqr.d.mts` / `uqr.LICENSE`

QR **encoder** — turns a string into a module matrix.

| | |
|---|---|
| Upstream | https://github.com/unjs/uqr |
| Version | `0.1.3` (published 2026-04-03) |
| Licence | MIT |
| Dependencies | none |
| Source | the published `dist/index.mjs`, which ships unminified |

Chosen over writing our own because the encoder needs Reed–Solomon error
correction over GF(256), mask-pattern penalty scoring and BCH-coded format
information — a correctness minefield with an audited answer available. A
subtly wrong encoder produces codes that scan on the developer's phone and
fail on someone else's, which is the worst possible failure mode.

Note that the npm package literally named `qrcodegen` is **not** the
well-known Nayuki implementation people mean by that name — it is an unrelated
`0.0.1` from 2022. Do not install it.

Beyond the matrix, uqr exposes a `types` array marking each module as
Position, Timing, Alignment, Function or Data. That is what lets `ecc.ts`
identify function patterns exactly, rather than inferring their location
geometrically.

**Local change:** one `export { … }` statement appended to each of `uqr.mjs`
and `uqr.d.mts`, exposing `ECC_CODEWORDS_PER_BLOCK`,
`NUM_ERROR_CORRECTION_BLOCKS`, `getNumRawDataModules` and
`getNumDataCodewords`. These are already module-scope constants upstream and
simply are not part of its public surface; `ecc.ts` needs them to account for
the correction budget, and re-typing 160 values out of ISO/IEC 18004 by hand
would be a transcription risk for no benefit. **No logic is modified.** The
additions are the last lines of each file so an upstream diff stays trivial.

## Updating

1. `npm pack uqr@<version>` and extract it.
2. Diff `dist/index.mjs` against `vendor/uqr.mjs`, ignoring the trailing
   addition described above.
3. Read the diff. That is the point of vendoring.
4. Copy the new files in, re-apply the export block, update the version here.
5. `npm run test:lib`. The round-trip and golden-corpus tests are what prove
   the new version still encodes identically.
