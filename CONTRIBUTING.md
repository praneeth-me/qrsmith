# Contributing

Thanks for looking. This is a small, deliberately narrow library: it builds QR
payloads, works out what they mean physically, and says what will stop them
scanning. It is not trying to become a general barcode toolkit, and scope
creep is the main thing that would ruin it.

## Where the code actually lives

**This repository is a mirror.** The library is developed inside the
[praneeth.me website repository](https://github.com/praneeth-me/praneeth.me-website)
under `qrsmith/`, and published here by a script that force-pushes a subtree
split. Every publish replaces this repository's history wholesale, so a commit
made here is destroyed the next time it runs.

Open issues here; send changes to the upstream repository.

## Getting set up

```bash
npm install
npm test          # node:test
npm run typecheck # tsc --noEmit
```

No build step for development. Node 22.6+ runs the TypeScript source directly
via native type stripping, so `npm test` executes `src/` as-is.

## What good looks like here

**Comment the reasoning, not the mechanics.** Nearly every rule in this
library exists because some correct-looking choice breaks on real scanners.
The rule is easy to read off the code; *why* it is that way is not, and it is
the part that stops someone helpfully undoing it later. Cite the specification
where one applies.

**Severity means something specific.** `error` is reserved for "the artifact
is broken" — it will not reliably scan, or it encodes something other than
what was asked for. Advice, however strongly held, is not an error. See the
table in the README.

**Codes are the stable API.** A `code` never changes meaning. A new situation
gets a new code; if severity needs re-tuning, that is a note in the changelog.

**Byte length, never `String.length`.** Anything measuring size uses the
encoded byte length. Emoji and CJK make the two disagree by 2× or more, and
getting it wrong produces a code that is over capacity while the caller is
told it fits.

## Tests

New rules need a fixture. If a diagnostic carries a correctness claim — "use
this instead, because that one fails on X" — **assert the wording**, not just
that the code fired. Precise diagnostics decay into vague ones otherwise, and
the precision was the point.

The property test in `test/roundtrip.test.ts` is the one that finds real bugs:
random payloads, encoded, rasterised and decoded back. If you touch a builder,
run it. If you add a payload kind, add it to the generator.

## Vendored code

`vendor/` holds the encoder and decoder, committed rather than installed.
Don't reformat them and don't fix their lint warnings — they are kept
byte-identical to upstream so a version bump produces a readable diff. See
`vendor/README.md` for the update procedure.
