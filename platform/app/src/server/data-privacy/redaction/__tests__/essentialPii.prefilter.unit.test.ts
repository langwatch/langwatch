/**
 * Some recognizers are skipped on text that cannot contain their pattern —
 * the email pattern never runs on text without an "@", and so on. The saving
 * is real (that one pattern measured 2.6% of the worker's wall time), and so
 * is the failure mode: a literal claimed by a pattern that does not actually
 * require it stops redacting real personal data, silently, forever.
 *
 * These cases exist to make that failure loud. The rest of the redaction
 * behaviour is covered by `essentialPii.unit.test.ts`; what is here is
 * specifically the interaction between the skip and the entities it must not
 * touch.
 */

import {
  findPhoneNumbersInText,
  getCountries,
  getExampleNumber,
} from "libphonenumber-js";
import examples from "libphonenumber-js/examples.mobile.json" with {
  type: "json",
};
import { describe, expect, it } from "vitest";

import { redactEssentialPiiInText } from "../essentialPii";

const redact = (text: string) => redactEssentialPiiInText({ text }).text;

describe("given a recognizer that is skipped unless the text holds its literal", () => {
  describe("when the literal is present", () => {
    /** @scenario "Skipped detectors still find their own kind of personal data" */
    it("still redacts an email address", () => {
      expect(redact("write to ada@example.com today")).toBe(
        "write to [EMAIL_ADDRESS] today",
      );
    });

    /** @scenario "Skipped detectors still find their own kind of personal data" */
    it("still redacts an Ethereum address", () => {
      expect(
        redact("paid 0x52908400098527886E0F7030069857D2E4169EE7 out"),
      ).toContain("[CRYPTO]");
    });

    /** @scenario "Skipped detectors still find their own kind of personal data" */
    it("still redacts an IPv6 address", () => {
      expect(redact("host fe80::1ff:fe23:4567:890a end")).toContain(
        "[IP_ADDRESS]",
      );
    });
  });

  /**
   * The mis-annotation catcher. Every sample below is personal data that some
   * OTHER recognizer must find, written so it contains none of the literals
   * the skipped recognizers claim ("@", "0x", ":"). If a literal is ever
   * attached to a pattern that does not truly require it, that recognizer
   * stops running on text like this and the sample survives unredacted.
   */
  describe("when the text holds none of the claimed literals", () => {
    const withoutClaimedLiterals = (text: string) => {
      // Guards the fixtures themselves: a sample that accidentally contained
      // one of these would pass the test without exercising anything.
      for (const literal of ["@", "0x", ":"]) {
        expect(text).not.toContain(literal);
      }
      return text;
    };

    /** @scenario "Personal data is still redacted when the text holds no address marker" */
    it.each([
      ["an IPv4 address", "from 192.168.0.1 today", "[IP_ADDRESS]"],
      ["a credit card number", "card 4111 1111 1111 1111 ok", "[CREDIT_CARD]"],
      ["an IBAN", "iban GB82WEST12345698765432 ok", "[IBAN_CODE]"],
      ["a US social security number", "ssn 123-45-6789 on file", "[US_SSN]"],
    ])("still redacts %s", (_label, text, marker) => {
      expect(redact(withoutClaimedLiterals(text))).toContain(marker);
    });
  });

  describe("when the text is long and holds no literal at all", () => {
    /** @scenario "A long value holding no personal data is returned unchanged" */
    it("leaves it untouched", () => {
      // The shape the skip exists for: a long alphanumeric run is exactly
      // what made the unanchored email pattern quadratic.
      const payload = `{"token":"${"a1b2c3d4e5".repeat(200)}"}`;

      expect(redact(payload)).toBe(payload);
    });
  });
});

/**
 * The phone detector is skipped on text whose longest digit window is too short
 * to hold a number. It is the one detector where the saving is measured in
 * hundreds of milliseconds instead of single ones: 200 KB of JSON with numeric
 * fields cost 240 ms and found nothing.
 *
 * The floor must stay below the shortest number the detector will return, and
 * the detector itself is the only honest reference for that. These cases run
 * every country's own example number through the public redaction path and
 * require that anything the library finds is still marked. Raise the floor too
 * far and the small territories fail here first.
 */
describe("given the phone detector's digit gate", () => {
  const shapesOf = ({
    formatted,
    plain,
  }: {
    formatted: string;
    plain: string;
  }) => [plain, formatted, `call ${formatted} now`, `{"phone":"${plain}"}`];

  describe("when the text holds a number of any country", () => {
    /** @scenario "A phone number is redacted whatever country it belongs to" */
    it("still redacts every example number the detector recognises", () => {
      const missed: string[] = [];
      let recognised = 0;
      for (const country of getCountries()) {
        const example = getExampleNumber(country, examples);
        if (!example) continue;
        for (const shape of shapesOf({
          formatted: example.formatInternational(),
          plain: example.number,
        })) {
          const found = findPhoneNumbersInText(shape, { defaultCountry: "US" });
          if (found.length === 0) continue;
          recognised++;
          if (!redact(shape).includes("[PHONE_NUMBER]")) missed.push(shape);
        }
      }
      expect(recognised).toBeGreaterThan(500);
      expect(missed).toEqual([]);
    });
  });

  describe("when the text holds digits but no number", () => {
    /** @scenario "Numeric text that is no phone number is left alone" */
    it("leaves alone the numeric text that carries no number", () => {
      for (const input of [
        "the release notes for the 3.9.0 tag say so",
        '{"input_tokens":15234,"cost_usd":0.0412}',
        "retry 3 times after 45 seconds",
      ]) {
        expect(redact(input)).toBe(input);
      }
    });
  });
});
