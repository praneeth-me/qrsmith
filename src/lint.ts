import type { BuiltPayload, Payload } from "./types.ts";
import { buildEmail } from "./payload/email.ts";
import { buildSms } from "./payload/sms.ts";
import { buildTel } from "./payload/tel.ts";
import { buildText } from "./payload/text.ts";
import { buildUrl } from "./payload/url.ts";
import { buildVCard } from "./payload/vcard.ts";
import { buildWifi } from "./payload/wifi.ts";

/**
 * Serialise a payload and collect everything found while doing it.
 *
 * Building and validating are one operation rather than two, because for
 * every format here the validation *is* a by-product of serialising: you
 * discover the SSID needed escaping while escaping it. Splitting them would
 * mean walking the same fields twice and keeping two sets of rules in step.
 * (dmarcbis splits parse from validate for the opposite reason — there, one
 * input is checked against rules that have nothing to do with parsing it.)
 *
 * `text` is always returned, even alongside an error, because the UI shows
 * the assembled payload live and blanking it hides the thing being fixed.
 */
export function buildPayload(payload: Payload): BuiltPayload {
  switch (payload.kind) {
    case "url":
      return buildUrl(payload);
    case "text":
      return buildText(payload);
    case "wifi":
      return buildWifi(payload);
    case "vcard":
      return buildVCard(payload);
    case "email":
      return buildEmail(payload);
    case "sms":
      return buildSms(payload);
    case "tel":
      return buildTel(payload);
  }
}
