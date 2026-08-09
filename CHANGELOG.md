# Changelog

## Policy

`code` values are the **stable API**. A code never changes meaning: a new
situation gets a new code rather than repurposing an old one, so anything
switching on, suppressing or translating a code keeps working.

`severity` is a **judgement** and may be re-tuned against evidence. A change
of severity is a minor-version note here, never a silent one.

## 0.1.0 — unreleased

First cut. Not published; `private: true` until there is a build emitting
`.js` + `.d.ts` (see README).

### Payload builders

`url`, `text`, `wifi`, `vcard` (3.0), `email`, `sms`, `tel`.

Rules worth naming, because they are the reason the library exists:

- Wi-Fi metacharacter escaping in a single pass, so the backslash cannot be
  double-escaped by a later replace.
- Wi-Fi field order follows the WPA3 specification grammar (§7.1: T, R, S, H,
  I, P, K), matching its own example `WIFI:T:WPA;R:1;S:MyNet;P:MyPassword;;`.
- `wifi-sae-compatibility` recommends `T:WPA` over `T:SAE`, and `T:WPA;R:1`
  for WPA3-only networks — which is what the specification's example uses.
- PSK bounds enforced (8–63 characters, or a raw 64-digit hex PMK) as errors:
  outside them no access point can be configured, so the code cannot work.
  WEP keys are validated under both the ASCII and hex readings, because they
  overlap — `abcde` is a valid five-character key that also looks hexadecimal.
- `wifi-password-weak` for passwords that fall to an offline dictionary attack
  on a captured handshake, which is the attack WPA2 actually permits.
- `wifi-open-network` and a rewritten `wifi-wep-deprecated`: every security
  type is offered, each with what it costs.
- `wifi-wpa3-only-compat` names the device floor for `R:1` — Android 10 and
  iOS 13, both 2019 — because "most secure" and "most compatible" point in
  opposite directions and the operator has to choose.
- An all-hex password is quoted only at 10, 26 or 64 characters. The ZXing
  convention quotes any all-hex value, but quotes a parser does not strip
  become part of the credential, and `12345678` is a very common password.
- `url-alphanumeric-savings` only fires when uppercasing the scheme and host
  would actually change the encoding mode for the whole payload. Paths are
  never touched.
- vCard omits line folding deliberately: it costs three bytes per break to
  solve a terminal-width problem that does not exist in a QR code.

### Geometry and error correction

- Version/module maths for all 40 versions, the 10:1 sizing rule, a documented
  per-process module floor, quiet zone and required DPI.
- The reverse check: whether a payload's version leaves modules too fine to
  print at the requested width.
- Error correction reported as budget spent rather than headroom available,
  with correctable codewords counted as half the parity — a decoder does not
  know where a logo is, so damage costs two parity symbols per codeword.
- Function-pattern coverage is an error rather than a budget cost, counted
  from the encoder's own module type map so alignment patterns are found
  wherever the version puts them.

### Notes

- Zero runtime dependencies. The encoder (uqr) and decoder (jsQR) are
  vendored; see `vendor/README.md`.
- All size arithmetic uses encoded byte length, never `String.length`.
