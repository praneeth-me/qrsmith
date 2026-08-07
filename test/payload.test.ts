import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPayload } from "../src/lint.ts";
import { alphanumericVariant } from "../src/payload/url.ts";
import type { Diagnostic, Payload, VCardFields } from "../src/types.ts";

/** Codes present, for asserting which findings fired. */
const codes = (diagnostics: Diagnostic[]) => diagnostics.map(d => d.code);

/** The one finding with a given code, or undefined. */
const find = (diagnostics: Diagnostic[], code: string) =>
  diagnostics.find(d => d.code === code);

const wifi = (over: Partial<Extract<Payload, { kind: "wifi" }>> = {}) =>
  buildPayload({
    kind: "wifi",
    ssid: "Net",
    password: "hunter22",
    security: "WPA",
    hidden: false,
    wpa3Only: false,
    ...over,
  });

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

describe("wifi escaping", () => {
  // THE case. Escaping these characters with sequential replaces re-escapes
  // the backslashes the earlier pass inserted, and the failure is invisible
  // until someone's phone refuses to join a network at a conference.
  //
  // A literal backslash followed by a semicolon must come out as \\ then \;
  // — four characters — not as \\; which reads back as one escaped backslash
  // and then a raw field terminator.
  it("escapes a backslash before the character that follows it", () => {
    const { text } = wifi({ ssid: "a\\;b" });
    assert.match(text, /S:a\\\\\\;b;/);
    assert.ok(
      !text.includes("S:a\\\\;b;"),
      "the semicolon was left unescaped — sequential-replace bug"
    );
  });

  it("escapes each reserved character exactly once", () => {
    const cases: [string, string][] = [
      ["My;Net", "My\\;Net"],
      ['pa"ss', 'pa\\"ss'],
      ["a:b", "a\\:b"],
      ["x,y", "x\\,y"],
      ["back\\slash", "back\\\\slash"],
      ["all\\;,:\"of", 'all\\\\\\;\\,\\:\\"of'],
    ];
    for (const [input, expected] of cases) {
      const { text } = wifi({ ssid: input });
      assert.equal(
        text,
        `WIFI:T:WPA;S:${expected};P:hunter22;;`,
        `escaping ${JSON.stringify(input)}`
      );
    }
  });

  it("escapes the password on the same rules as the ssid", () => {
    const { text } = wifi({ password: 'p;a"ss\\' });
    assert.equal(text, 'WIFI:T:WPA;S:Net;P:p\\;a\\"ss\\\\;;');
  });

  it("leaves an ordinary value untouched", () => {
    const { text } = wifi({ ssid: "Cafe Ravel", password: "flat white" });
    assert.equal(text, "WIFI:T:WPA;S:Cafe Ravel;P:flat white;;");
  });

  it("flags that escaping happened so it can be eyeballed", () => {
    assert.ok(codes(wifi({ ssid: "My;Net" }).diagnostics).includes(
      "wifi-metachar-escaped"
    ));
    assert.ok(
      !codes(wifi({ ssid: "MyNet" }).diagnostics).includes(
        "wifi-metachar-escaped"
      )
    );
  });

  // A /g regex used with .test() carries lastIndex between calls, so a naive
  // implementation returns true, then false, then true for identical input.
  it("detects metacharacters consistently across repeated calls", () => {
    for (let i = 0; i < 4; i++) {
      assert.ok(
        codes(wifi({ ssid: "My;Net" }).diagnostics).includes(
          "wifi-metachar-escaped"
        ),
        `call ${i} disagreed with the others`
      );
    }
  });

  it("quotes an all-hex ssid so it is not read as bytes", () => {
    const { text, diagnostics } = wifi({ ssid: "deadbeef" });
    assert.equal(text, 'WIFI:T:WPA;S:"deadbeef";P:hunter22;;');
    assert.ok(codes(diagnostics).includes("wifi-hex-quoted"));
  });
});

describe("wifi compatibility rules", () => {
  // The wording carries the correctness claim, not just the code. dmarcbis
  // asserts diagnostic text for the same reason: a precise finding that
  // decays into "this may not work" has lost the thing that made it useful.
  it("names the WPA wildcard behaviour when SAE is chosen", () => {
    const diagnostic = find(
      wifi({ security: "SAE" }).diagnostics,
      "wifi-sae-compatibility"
    );
    assert.ok(diagnostic, "expected wifi-sae-compatibility");
    assert.equal(diagnostic.severity, "warning");
    assert.match(diagnostic.message, /wildcard/i);
    assert.match(diagnostic.message, /R:1/);
    assert.match(diagnostic.message, /WPA3/);
  });

  it("emits R:1 only for WPA3-only networks on WPA", () => {
    assert.match(wifi({ wpa3Only: true }).text, /;R:1;;$/);
    assert.ok(!wifi({ wpa3Only: false }).text.includes("R:1"));

    const wrong = wifi({ wpa3Only: true, security: "WEP" });
    assert.ok(!wrong.text.includes("R:1"));
    assert.ok(codes(wrong.diagnostics).includes("wifi-wpa3only-ignored"));
  });

  it("treats an open network with a password as a contradiction", () => {
    const open = wifi({ security: "nopass", password: "hunter22" });
    assert.equal(
      find(open.diagnostics, "wifi-nopass-with-password")?.severity,
      "error"
    );
    assert.ok(!open.text.includes("P:"), "no password field on an open network");
  });

  it("requires a password when the security type needs one", () => {
    assert.ok(
      codes(wifi({ password: "" }).diagnostics).includes(
        "wifi-password-required"
      )
    );
    assert.ok(
      !codes(
        wifi({ security: "nopass", password: "" }).diagnostics
      ).includes("wifi-password-required")
    );
  });

  it("warns about the hidden flag rather than trusting it silently", () => {
    const diagnostic = find(
      wifi({ hidden: true }).diagnostics,
      "wifi-hidden-flag-risk"
    );
    assert.ok(diagnostic);
    assert.match(diagnostic.message, /iOS/);
  });

  it("always says the password is readable", () => {
    const diagnostic = find(wifi().diagnostics, "wifi-secret-in-artifact");
    assert.ok(diagnostic);
    assert.equal(diagnostic.severity, "info");
    assert.match(diagnostic.message, /not encryption/i);
  });

  it("flags WEP", () => {
    assert.ok(
      codes(wifi({ security: "WEP" }).diagnostics).includes(
        "wifi-wep-deprecated"
      )
    );
  });

  // Byte length, never String.length — an emoji is 4 bytes on the wire and
  // 2 UTF-16 code units, so a naive check passes a name that cannot exist.
  it("measures the ssid limit in bytes, not code units", () => {
    const eightEmoji = "\u{1F600}".repeat(8); // 32 bytes, 16 code units
    assert.ok(
      !codes(wifi({ ssid: eightEmoji }).diagnostics).includes(
        "wifi-ssid-too-long"
      ),
      "32 bytes is exactly the limit"
    );
    const nineEmoji = "\u{1F600}".repeat(9); // 36 bytes
    assert.ok(
      codes(wifi({ ssid: nineEmoji }).diagnostics).includes(
        "wifi-ssid-too-long"
      )
    );
  });

  it("rejects an empty ssid", () => {
    assert.equal(
      find(wifi({ ssid: "" }).diagnostics, "wifi-empty-ssid")?.severity,
      "error"
    );
  });
});

describe("url", () => {
  const url = (u: string) => buildPayload({ kind: "url", url: u });

  it("treats a schemeless address as an error", () => {
    const diagnostic = find(url("example.com").diagnostics, "url-not-absolute");
    assert.equal(diagnostic?.severity, "error");
    assert.match(diagnostic.message, /https:\/\//);
  });

  it("offers the uppercase form only when the whole payload benefits", () => {
    // Bare host: uppercasing makes everything alphanumeric-encodable.
    assert.ok(
      codes(url("https://example.com/").diagnostics).includes(
        "url-alphanumeric-savings"
      )
    );
    // A lowercase path keeps it in byte mode, so there is nothing to gain
    // and offering the swap would be actively wrong.
    assert.ok(
      !codes(url("https://example.com/some/path").diagnostics).includes(
        "url-alphanumeric-savings"
      )
    );
    // A query string carries ? and = which are outside the alphanumeric set.
    assert.ok(
      !codes(url("https://example.com/?a=1").diagnostics).includes(
        "url-alphanumeric-savings"
      )
    );
  });

  it("never uppercases the path, which is case-sensitive", () => {
    assert.equal(
      alphanumericVariant("https://example.com/PATH"),
      "HTTPS://EXAMPLE.COM/PATH"
    );
    assert.equal(alphanumericVariant("https://example.com/path"), null);
    // Already uppercase: nothing to offer.
    assert.equal(alphanumericVariant("HTTPS://EXAMPLE.COM/"), null);
  });

  it("flags shorteners but not first-party short domains", () => {
    assert.ok(
      codes(url("https://bit.ly/abc").diagnostics).includes(
        "url-shortener-detected"
      )
    );
    assert.ok(
      !codes(url("https://youtu.be/abc").diagnostics).includes(
        "url-shortener-detected"
      )
    );
  });

  it("flags plain http", () => {
    assert.ok(
      codes(url("http://example.com/").diagnostics).includes("url-not-https")
    );
  });

  it("rejects an empty address", () => {
    assert.ok(codes(url("   ").diagnostics).includes("payload-empty"));
  });
});

describe("vcard", () => {
  const card = (over: Partial<VCardFields>) =>
    buildPayload({ kind: "vcard", fields: { ...EMPTY_VCARD, ...over } });

  it("uses CRLF, which some parsers require to separate properties", () => {
    const { text } = card({ firstName: "Ada", lastName: "Lovelace" });
    assert.ok(text.includes("\r\n"));
    assert.ok(!/[^\r]\n/.test(text), "found a bare LF");
  });

  it("declares version 3.0", () => {
    assert.match(card({ firstName: "Ada" }).text, /^BEGIN:VCARD\r\nVERSION:3\.0\r\n/);
  });

  it("escapes semicolons and commas without touching colons", () => {
    const { text } = card({ organisation: "Bode, Ltd; Co", title: "Head: Ops" });
    assert.ok(text.includes("ORG:Bode\\, Ltd\\; Co"));
    assert.ok(text.includes("TITLE:Head: Ops"), "colon must stay literal");
  });

  it("turns newlines in a note into the literal \\n sequence", () => {
    const { text } = card({ firstName: "Ada", note: "line one\nline two" });
    assert.ok(text.includes("NOTE:line one\\nline two"));
    const body = text.split("\r\n").find(l => l.startsWith("NOTE:"));
    assert.ok(body && !body.includes("\n"));
  });

  it("requires a name", () => {
    assert.equal(
      find(card({ organisation: "Acme" }).diagnostics, "vcard-no-name")
        ?.severity,
      "error"
    );
  });

  it("warns once the card is too dense for a business card", () => {
    const diagnostic = find(
      card({ firstName: "Ada", note: "x".repeat(320) }).diagnostics,
      "vcard-over-budget"
    );
    assert.ok(diagnostic);
    assert.match(diagnostic.message, /\d+ bytes/);
  });

  it("omits fields that were left blank", () => {
    const { text } = card({ firstName: "Ada" });
    assert.ok(!text.includes("ORG:"));
    assert.ok(!text.includes("ADR"));
    assert.ok(!text.includes("NOTE:"));
  });
});

describe("email, sms and tel", () => {
  it("percent-encodes the subject and body", () => {
    const { text } = buildPayload({
      kind: "email",
      to: "a@b.com",
      subject: "Hello & goodbye",
      body: "line one\nline two",
    });
    assert.ok(text.includes("subject=Hello%20%26%20goodbye"));
    assert.ok(text.includes("body=line%20one%0Aline%20two"));
    assert.ok(!text.includes(" "), "a raw space truncates the draft");
  });

  it("rejects an address that cannot work", () => {
    assert.equal(
      find(
        buildPayload({ kind: "email", to: "nope", subject: "", body: "" })
          .diagnostics,
        "email-invalid-address"
      )?.severity,
      "error"
    );
  });

  it("uses SMSTO and flags an unescapable colon", () => {
    const { text, diagnostics } = buildPayload({
      kind: "sms",
      number: "+61400000000",
      message: "Table 4: ready",
    });
    assert.equal(text, "SMSTO:+61400000000:Table 4: ready");
    assert.ok(codes(diagnostics).includes("sms-colon-in-message"));
  });

  it("strips presentational characters from a phone number", () => {
    const { text } = buildPayload({
      kind: "tel",
      number: "+61 (400) 000-000",
    });
    assert.equal(text, "tel:+61400000000");
  });

  it("notes a missing country code", () => {
    assert.ok(
      codes(
        buildPayload({ kind: "tel", number: "0400000000" }).diagnostics
      ).includes("tel-not-e164")
    );
  });
});

describe("text", () => {
  it("flags content that needs a UTF-8 ECI header", () => {
    assert.ok(
      codes(
        buildPayload({ kind: "text", text: "café ☕" }).diagnostics
      ).includes("text-mode-eci-utf8")
    );
    assert.ok(
      !codes(
        buildPayload({ kind: "text", text: "plain ascii" }).diagnostics
      ).includes("text-mode-eci-utf8")
    );
  });

  it("passes text through unchanged", () => {
    const input = "anything at all; including: metacharacters\\";
    assert.equal(buildPayload({ kind: "text", text: input }).text, input);
  });
});

describe("the contract", () => {
  // Every payload kind must be handled — a new kind added to the union
  // without a builder should fail here rather than at runtime.
  it("builds every payload kind without throwing", () => {
    const all: Payload[] = [
      { kind: "url", url: "https://example.com/" },
      { kind: "text", text: "hi" },
      {
        kind: "wifi",
        ssid: "Net",
        password: "pw",
        security: "WPA",
        hidden: false,
        wpa3Only: false,
      },
      { kind: "vcard", fields: { ...EMPTY_VCARD, firstName: "Ada" } },
      { kind: "email", to: "a@b.com", subject: "", body: "" },
      { kind: "sms", number: "+61400000000", message: "hi" },
      { kind: "tel", number: "+61400000000" },
    ];
    for (const payload of all) {
      const built = buildPayload(payload);
      assert.equal(typeof built.text, "string");
      assert.ok(Array.isArray(built.diagnostics));
      assert.ok(
        built.diagnostics.every(
          d => d.code && d.message && ["error", "warning", "info"].includes(d.severity)
        ),
        `malformed diagnostic from ${payload.kind}`
      );
    }
  });
});
