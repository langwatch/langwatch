/**
 * Spec: specs/data-privacy/pii-redaction.feature. Numbers written the national
 * way, with no country code, which the US reading of the phone detector misses.
 */

import type { CountryCode } from "libphonenumber-js";
import { getExampleNumber } from "libphonenumber-js";
import examples from "libphonenumber-js/examples.mobile.json" with { type: "json" };
import { describe, expect, it } from "vitest";

import { redactEssentialPiiInText } from "../essentialPii.ts";

const redact = (text: string) => redactEssentialPiiInText({ text }).text;

const NATIONAL_MOBILES: readonly { region: string; written: string }[] = [
  { region: "United Kingdom", written: "07911 123456" },
  { region: "United Kingdom, unspaced", written: "07911123456" },
  { region: "Netherlands", written: "06 12345678" },
  { region: "Netherlands, unspaced", written: "0612345678" },
  { region: "Netherlands, dashed", written: "06-12345678" },
  { region: "Germany", written: "0151 23456789" },
  { region: "France", written: "06 12 34 56 78" },
  { region: "France, dotted", written: "06.12.34.56.78" },
  { region: "Belgium", written: "0470 12 34 56" },
  { region: "Spain", written: "612 345 678" },
  { region: "Italy", written: "347 123 4567" },
  { region: "Portugal", written: "912 345 678" },
  { region: "Ireland", written: "085 123 4567" },
  { region: "Austria", written: "0664 1234567" },
  { region: "Switzerland", written: "079 123 45 67" },
  { region: "Australia", written: "0412 345 678" },
  { region: "India", written: "98765 43210" },
  { region: "Brazil", written: "(11) 91234-5678" },
];

const COVERED_REGIONS: readonly CountryCode[] = [
  "GB",
  "NL",
  "DE",
  "FR",
  "BE",
  "IE",
  "AT",
  "CH",
  "AU",
  "ES",
  "PT",
  "IT",
  "IN",
  "BR",
];

describe("given a mobile number written without its country code", () => {
  describe("when it appears in a sentence", () => {
    /** @scenario "A phone number written without its country code is redacted" */
    it.each(NATIONAL_MOBILES)("redacts the $region number $written", ({ written }) => {
      expect(redact(`call me on ${written} tomorrow`)).toBe("call me on [PHONE_NUMBER] tomorrow");
    });
  });

  describe("when it is each covered region's own example number", () => {
    /** @scenario "A phone number written without its country code is redacted" */
    it("redacts every one, in a sentence and in a JSON value", () => {
      const missed: string[] = [];
      for (const region of COVERED_REGIONS) {
        const national = getExampleNumber(region, examples)?.formatNational();
        if (!national) throw new Error(`no example mobile for ${region}`);
        for (const shape of [`call ${national} now`, `{"phone":"${national}"}`]) {
          const redacted = redact(shape);
          if (redacted !== shape.replace(national, "[PHONE_NUMBER]")) {
            missed.push(`${region}: ${shape} -> ${redacted}`);
          }
        }
      }
      expect(missed).toEqual([]);
    });
  });

  describe("when the text holds national and international numbers together", () => {
    /** @scenario "A phone number written without its country code is redacted" */
    it("redacts each of them once", () => {
      const result = redactEssentialPiiInText({
        text: "mobile 06 12345678, office +31 20 123 4567, uk 07911 123456",
      });
      expect(result.text).toBe("mobile [PHONE_NUMBER], office [PHONE_NUMBER], uk [PHONE_NUMBER]");
      expect(result.redactedCount).toBe(3);
    });
  });

  describe("when it is a landline written with its area code", () => {
    /** @scenario "A phone number written without its country code is redacted" */
    it("redacts it", () => {
      expect(redact("office 020 7946 0958")).toBe("office [PHONE_NUMBER]");
      expect(redact("kantoor 030 123 4567")).toBe("kantoor [PHONE_NUMBER]");
    });
  });

  describe("when it sits inside an identifier", () => {
    /** @scenario "A barcode, date, timestamp or order number is not read as a national phone number" */
    it("keeps the identifier whole", () => {
      for (const input of ["ref ORD-0612345678 shipped", "ticket #0612345678 open"]) {
        expect(redact(input)).toBe(input);
      }
    });
  });
});

describe("given numeric text that is no phone number", () => {
  describe("when it is a barcode, date, timestamp, invoice or order number", () => {
    /** @scenario "A barcode, date, timestamp or order number is not read as a national phone number" */
    it.each([
      ["an EAN-13 barcode", "EAN 8711253039152"],
      ["an EAN-13 barcode with a leading zero pair", "EAN 0012345678905"],
      ["another EAN-13 barcode", "barcode 4006381333931"],
      ["an order number", "order 123456789 shipped"],
      ["an order number that starts like a mobile", "order 612345678 shipped"],
      ["an order number padded with zeros", "order 0000612345 shipped"],
      ["an invoice number", "invoice INV-2026-001234"],
      ["a dated invoice number", "invoice 20261023001"],
      ["an ISO date", "due 2026-10-23"],
      ["an ISO timestamp", "at 2026-10-23T12:34:56.789Z"],
      ["a European date and time", "on 03.10.2026 10:15"],
      ["a slashed date and time", "on 12/10/2026 14:30"],
      ["a Unix timestamp in seconds", "ts 1729680000"],
      ["a Unix timestamp in milliseconds", "ts 1729680000123"],
      ["a decimal", "score 0.123456789"],
      ["a coordinate pair", "lat 52.3676543 lon 4.9041234"],
      ["an amount with thousands separators", "total 1 234 567 EUR"],
      ["a number range", "pages 1200-1350"],
    ])("leaves %s alone", (_label, input) => {
      expect(redact(input)).toBe(input);
    });
  });
});
