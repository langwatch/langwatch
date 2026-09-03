/**
 * The recognizers themselves, one pattern at a time.
 *
 * Beside `essentialPii.unit.test.ts` rather than folded into it: that suite is
 * bound to the span-PII spec's scenarios and reads as a contract, and this one
 * is the mechanical sweep — every entity, its checksums, and the near-misses
 * each pattern must NOT claim. A recognizer that stops firing is silent, and
 * these cases are what makes it loud.
 */
import { describe, expect, it } from "vitest";

import {
  compilePiiExceptPatterns,
  redactEssentialPiiInText,
  subtractProtectedRanges,
} from "../essentialPii.js";

const redact = (text: string) => redactEssentialPiiInText({ text });

describe("redactEssentialPiiInText", () => {
  describe("given an email address", () => {
    it("redacts it with a typed marker", () => {
      const { text } = redact("contact test@example.com please");
      expect(text).toBe("contact [EMAIL_ADDRESS] please");
    });
  });

  describe("given IP addresses", () => {
    it("redacts an IPv4 address", () => {
      expect(redact("from 192.168.0.1 today").text).toBe("from [IP_ADDRESS] today");
    });

    it("redacts an IPv6 address", () => {
      const { text } = redact("host fe80::1ff:fe23:4567:890a end");
      expect(text).toContain("[IP_ADDRESS]");
      expect(text).not.toContain("fe80");
    });

    it("does not treat a clock time as an IPv6 address", () => {
      expect(redact("the run finished at 12:34:56 sharp").text).toBe(
        "the run finished at 12:34:56 sharp",
      );
    });
  });

  describe("given a credit card number", () => {
    it("redacts a Luhn-valid number", () => {
      expect(redact("card 4111111111111111 ok").text).toBe("card [CREDIT_CARD] ok");
    });

    it("leaves a Luhn-invalid 16-digit order id intact", () => {
      const input = "order 1234567890123456 shipped";
      expect(redact(input).text).toBe(input);
    });
  });

  describe("given an IBAN", () => {
    it("redacts a checksum-valid IBAN", () => {
      expect(redact("iban DE89370400440532013000 here").text).toBe(
        "iban [IBAN_CODE] here",
      );
    });

    it("leaves a checksum-invalid IBAN intact", () => {
      const input = "iban DE89370400440532013001 here";
      expect(redact(input).text).toBe(input);
    });
  });

  describe("given phone numbers", () => {
    it("redacts an international number", () => {
      const { text } = redact("call +31 6 12345678 now");
      expect(text).toContain("[PHONE_NUMBER]");
      expect(text).not.toContain("12345678");
    });

    it("redacts a US number", () => {
      const { text } = redact("ring (415) 555-2671 today");
      expect(text).toContain("[PHONE_NUMBER]");
    });
  });

  describe("given a phone-shaped digit run inside a longer token", () => {
    /** @scenario "An identifier mentioned inside a sentence keeps its digits" */
    it("keeps an identifier that carries letters whole", () => {
      const input = "note hosted-eu-20260812-09 attached";
      const { text, redactedCount } = redact(input);
      expect(text).toBe(input);
      expect(redactedCount).toBe(0);
    });

    it("keeps the digits of a prefixed session id", () => {
      const input = "session sess_2026081209 opened";
      expect(redact(input).text).toBe(input);
    });

    /** @scenario "A digit run that reads as a phone number is still redacted in a sentence" */
    it("still redacts the same digits standing on their own", () => {
      expect(redact("ref 2026081209 checkpoint").text).toBe(
        "ref [PHONE_NUMBER] checkpoint",
      );
      expect(redact("call 2026081209 now").text).toBe("call [PHONE_NUMBER] now");
    });

    it("still redacts a digit run split by a separator, with no letters around", () => {
      expect(redact("dial 20260812-09 please").text).toBe("dial [PHONE_NUMBER] please");
    });

    it("still redacts a spaced international number after a letter run", () => {
      const { text } = redact("mobile: +31 6 12345678");
      expect(text).toContain("[PHONE_NUMBER]");
      expect(text).not.toContain("12345678");
    });

    it("still redacts a number carried by minified JSON, and keeps an id in the same payload", () => {
      const { text } = redact('{"id":"hosted-eu-20260812-09","phone":"+14155552671"}');
      expect(text).toBe('{"id":"hosted-eu-20260812-09","phone":"[PHONE_NUMBER]"}');
    });

    it("still redacts a number in a URL path", () => {
      expect(redact("see https://acme.example/u/2026081209 now").text).toBe(
        "see https://acme.example/u/[PHONE_NUMBER] now",
      );
    });
  });

  describe("given a bare nine-digit run", () => {
    it("leaves it intact without context", () => {
      const input = "ref 123456789 logged";
      expect(redact(input).text).toBe(input);
    });

    it("redacts it when an SSN context word is nearby", () => {
      const { text } = redact("SSN: 123456789 on file");
      expect(text).toContain("[US_SSN]");
      expect(text).not.toContain("123456789");
    });
  });

  describe("given a crypto wallet address", () => {
    it("redacts an Ethereum address", () => {
      const { text } = redact("to 0x52908400098527886E0F7030069857D2E4169EE7 now");
      expect(text).toContain("[CRYPTO]");
    });
  });

  describe("given provider response ids", () => {
    // A production analysis-service run flagged a MEDICAL_LICENSE inside an
    // OpenAI response id. The native recognizers are word-boundary anchored
    // and context-gated, so a letters+digits run inside one long token can
    // never match, even with a context word nearby in the payload.
    it("never matches inside a long alphanumeric id, even near a context word", () => {
      const payload =
        'license check for {"ai.response.id": "resp_0d34ab7ca006a2c21aab078819c9289f65178a3e10f"}';
      const { text, redactedCount } = redact(payload);
      expect(text).toBe(payload);
      expect(redactedCount).toBe(0);
    });

    it("leaves chat completion and request ids intact", () => {
      const payload =
        "chatcmpl-Ab12Cd34Ef56Gh78 req_9f8e7d6c5b4a3210 trace_dp2_1781159836000";
      const { text, redactedCount } = redact(payload);
      expect(text).toBe(payload);
      expect(redactedCount).toBe(0);
    });
  });

  describe("given a medical license number", () => {
    it("redacts a DEA-style number when context names it", () => {
      const { text } = redact("DEA license AB1234567 on record");
      expect(text).toContain("[MEDICAL_LICENSE]");
      expect(text).not.toContain("AB1234567");
    });

    it("leaves the same shape intact without context", () => {
      const input = "booking code AB1234567 confirmed";
      const { text } = redact(input);
      expect(text).toBe(input);
    });
  });

  describe("given a person's name", () => {
    it("leaves it untouched (names are the strict level)", () => {
      const input = "John Smith lives here";
      expect(redact(input).text).toBe(input);
    });
  });

  describe("given ordinary prose", () => {
    it("leaves it unchanged and reports zero redactions", () => {
      const input = "The agent summarized the document in three bullet points.";
      const { text, redactedCount } = redact(input);
      expect(text).toBe(input);
      expect(redactedCount).toBe(0);
    });
  });

  describe("given an input larger than the scan budget", () => {
    it("returns it untouched", () => {
      const input = "test@example.com " + "x".repeat(250_001);
      const { text, redactedCount } = redact(input);
      expect(text).toBe(input);
      expect(redactedCount).toBe(0);
    });
  });

  describe("given several PII spans in one string", () => {
    it("redacts each with its own typed marker and counts them", () => {
      const { text, redactedCount } = redact(
        "mail test@example.com ip 10.0.0.1 card 4111111111111111",
      );
      expect(text).toBe("mail [EMAIL_ADDRESS] ip [IP_ADDRESS] card [CREDIT_CARD]");
      expect(redactedCount).toBe(3);
    });
  });

  describe("when the input contains a Brazilian CPF", () => {
    it("redacts a check-digit-valid formatted CPF", () => {
      expect(redact("cpf 529.982.247-25 ok").text).toBe("cpf [BR_CPF] ok");
    });

    it("redacts a check-digit-valid bare CPF", () => {
      expect(redact("cpf 52998224725 ok").text).toBe("cpf [BR_CPF] ok");
    });

    it("leaves a CPF-shaped number with bad check digits intact", () => {
      const input = "ref 529.982.247-00 done";
      expect(redact(input).text).toBe(input);
    });

    it("leaves a repeated-digit sequence intact", () => {
      const input = "ref 111.111.111-11 done";
      expect(redact(input).text).toBe(input);
    });
  });

  describe("when an entity filter limits redaction to the custom level", () => {
    it("redacts only the selected identifiers", () => {
      const { text } = redactEssentialPiiInText({
        text: "mail test@example.com cpf 529.982.247-25 card 4111111111111111",
        entities: ["EMAIL_ADDRESS", "BR_CPF"],
      });
      expect(text).toBe("mail [EMAIL_ADDRESS] cpf [BR_CPF] card 4111111111111111");
    });

    it("does not run phone detection when PHONE_NUMBER is not selected", () => {
      const { text } = redactEssentialPiiInText({
        text: "call +1 415 555 2671 or mail test@example.com",
        entities: ["EMAIL_ADDRESS"],
      });
      expect(text).toContain("+1 415 555 2671");
      expect(text).toContain("[EMAIL_ADDRESS]");
    });

    it("redacts everything native when no filter is given", () => {
      const { redactedCount } = redact("mail test@example.com cpf 529.982.247-25");
      expect(redactedCount).toBe(2);
    });
  });

  describe("when the text is one attribute value", () => {
    const asValue = (text: string) =>
      redactEssentialPiiInText({ text, isAttributeValue: true });

    describe("given a value that is exclusively one identifier-shaped token", () => {
      it.each([
        "hosted-eu-20260812-09",
        "550e8400-e29b-41d4-a716-446655440000",
        "da39a3ee5e6b4b0d3255bfef95601890afd80709",
        "pod-10.0.0.1",
        "cache-1:ab:cd:ef",
        "license-AB1234567",
      ])("leaves %s exactly as it was sent", (value) => {
        const { text, redactedCount } = asValue(value);
        expect(text).toBe(value);
        expect(redactedCount).toBe(0);
      });
    });

    describe("given a value the recognizers can prove", () => {
      it("still redacts a checksum-valid card behind an identifier prefix", () => {
        expect(asValue("ref-4111111111111111").text).toBe("ref-[CREDIT_CARD]");
      });

      it("still redacts an email address that holds digits", () => {
        expect(asValue("jane.doe1985@example.com").text).toBe("[EMAIL_ADDRESS]");
      });
    });

    describe("given a value with no letters in it", () => {
      it.each(["+31 6 12345678", "20260812-09", "2026081209"])(
        "still redacts %s",
        (value) => {
          expect(asValue(value).text).toBe("[PHONE_NUMBER]");
        },
      );
    });

    describe("given a value that is a sentence rather than one token", () => {
      it("redacts as it does anywhere else", () => {
        expect(asValue("ref 2026081209 checkpoint").text).toBe(
          "ref [PHONE_NUMBER] checkpoint",
        );
      });
    });
  });
});

describe("redactEssentialPiiInText with exception patterns", () => {
  const withExceptions = (text: string, patterns: string[]) =>
    redactEssentialPiiInText({
      text,
      exceptPatterns: compilePiiExceptPatterns(patterns),
    });

  describe("given an exception for a business number format", () => {
    it("keeps the excepted number and still redacts other PII in the same text", () => {
      const { text, redactedCount } = withExceptions(
        "reservation 00528000043000 booked by test@example.com",
        ["00\\d{12}"],
      );
      expect(text).toBe("reservation 00528000043000 booked by [EMAIL_ADDRESS]");
      expect(redactedCount).toBe(1);
    });

    it("still redacts a card number the exception does not cover", () => {
      const { text } = withExceptions("card 4111111111111111 ok", ["00\\d{12}"]);
      expect(text).toBe("card [CREDIT_CARD] ok");
    });
  });

  describe("given an exception matching only part of the detected value", () => {
    /** @scenario An exception must cover the whole detected value */
    it("redacts anyway, since exceptions must cover the whole match", () => {
      const { text } = withExceptions("reservation 00528000043000 here", ["00\\d{6}"]);
      expect(text).toBe("reservation [CREDIT_CARD] here");
    });
  });

  describe("given an exception for one specific address", () => {
    it("keeps that address and redacts the rest", () => {
      const { text } = withExceptions(
        "write orders@acme.example or personal@example.com",
        ["orders@acme\\.example"],
      );
      expect(text).toBe("write orders@acme.example or [EMAIL_ADDRESS]");
    });
  });

  describe("given an exception covering a phone number", () => {
    it("keeps the excepted phone", () => {
      const phone = "+1 415 555 2671";
      const kept = withExceptions(`call ${phone} now`, ["\\+1 415 555 2671"]);
      expect(kept.text).toBe(`call ${phone} now`);
    });
  });
});

describe("compilePiiExceptPatterns", () => {
  it("anchors patterns to full matches", () => {
    const [compiled] = compilePiiExceptPatterns(["00\\d{12}"]);
    expect(compiled!.test("00528000043000")).toBe(true);
    expect(compiled!.test("x00528000043000")).toBe(false);
    expect(compiled!.test("005280000430001")).toBe(false);
  });

  it("skips invalid patterns instead of throwing", () => {
    const compiled = compilePiiExceptPatterns(["([unclosed", "ok\\d+"]);
    expect(compiled).toHaveLength(1);
    expect(compiled[0]!.test("ok123")).toBe(true);
  });
});

describe("subtractProtectedRanges", () => {
  const span = { start: 10, end: 20 };

  it("returns the span untouched when nothing overlaps", () => {
    expect(subtractProtectedRanges(span, [{ start: 0, end: 5 }])).toEqual([
      { start: 10, end: 20 },
    ]);
  });

  it("returns nothing when a protected range covers the whole span", () => {
    expect(subtractProtectedRanges(span, [{ start: 8, end: 22 }])).toEqual([]);
  });

  it("clips a partial overlap on either side", () => {
    expect(subtractProtectedRanges(span, [{ start: 5, end: 14 }])).toEqual([
      { start: 14, end: 20 },
    ]);
    expect(subtractProtectedRanges(span, [{ start: 16, end: 25 }])).toEqual([
      { start: 10, end: 16 },
    ]);
  });

  it("splits around a protected range in the middle", () => {
    expect(subtractProtectedRanges(span, [{ start: 13, end: 16 }])).toEqual([
      { start: 10, end: 13 },
      { start: 16, end: 20 },
    ]);
  });

  it("handles several protected ranges in one span", () => {
    expect(
      subtractProtectedRanges({ start: 0, end: 30 }, [
        { start: 5, end: 10 },
        { start: 20, end: 25 },
      ]),
    ).toEqual([
      { start: 0, end: 5 },
      { start: 10, end: 20 },
      { start: 25, end: 30 },
    ]);
  });
});
