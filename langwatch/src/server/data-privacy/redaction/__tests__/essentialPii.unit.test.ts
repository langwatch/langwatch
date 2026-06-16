import { describe, expect, it } from "vitest";

import { redactEssentialPiiInText } from "../essentialPii";

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
      expect(redact("from 192.168.0.1 today").text).toBe(
        "from [IP_ADDRESS] today",
      );
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
      expect(redact("card 4111111111111111 ok").text).toBe(
        "card [CREDIT_CARD] ok",
      );
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
      const { text } = redact(
        "to 0x52908400098527886E0F7030069857D2E4169EE7 now",
      );
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
      expect(text).toBe(
        "mail [EMAIL_ADDRESS] ip [IP_ADDRESS] card [CREDIT_CARD]",
      );
      expect(redactedCount).toBe(3);
    });
  });

  describe("given a Brazilian CPF", () => {
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

  describe("given an entity filter (the custom level)", () => {
    it("redacts only the selected identifiers", () => {
      const { text } = redactEssentialPiiInText({
        text: "mail test@example.com cpf 529.982.247-25 card 4111111111111111",
        entities: ["EMAIL_ADDRESS", "BR_CPF"],
      });
      expect(text).toBe(
        "mail [EMAIL_ADDRESS] cpf [BR_CPF] card 4111111111111111",
      );
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
      const { redactedCount } = redact(
        "mail test@example.com cpf 529.982.247-25",
      );
      expect(redactedCount).toBe(2);
    });
  });
});
