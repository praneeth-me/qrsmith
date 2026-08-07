# Security

## Scope

`qrsmith` is a pure computation library. It performs no I/O: no network, no
filesystem, no environment access. Given a payload it returns a string, a
matrix and a list of diagnostics.

The consumer this was written for runs it entirely in a browser tab, where
nothing it touches leaves the device.

## Handling untrusted input

Payload fields are assumed to be untrusted and are treated as data throughout.
Two consequences worth stating:

- **Diagnostic messages quote input back.** A message may contain a fragment
  of the value it is complaining about. Anything rendering diagnostics must
  treat `message` as **text, never markup** — the reference consumer uses
  `textContent` exclusively for exactly this reason.
- **The library does not sanitise for other contexts.** A payload string is
  correct for a QR code; it is not automatically safe to interpolate into
  HTML, SQL, a shell command or an SVG attribute. Escape at the boundary you
  are crossing.

## A QR code is not encryption

Anything encoded is readable by anyone who scans or photographs the image.
This is a property of the format, not a limitation of this library, and it is
the single most common misunderstanding about Wi-Fi and contact codes. The
library emits `wifi-secret-in-artifact` on every Wi-Fi payload for that reason.

## Vendored code

The encoder and decoder are committed to this repository rather than installed
from npm, which removes the realistic supply-chain risk for a package like
this. Both were reviewed before being committed and carry zero dependencies of
their own. See `vendor/README.md` for versions and update procedure.

The decoder was checked for the property that matters in a browser tool: no
`fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `eval`, `new Function`,
`importScripts`, `document`, `window` or storage access anywhere in it.

## Reporting

Open an issue on the source repository. This is a personal project with no
formal SLA; anything genuinely sensitive is better raised privately first via
https://praneeth.me/contact.
