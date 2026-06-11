import { describe, expect, it } from "vitest";

import { redactEssentialPiiInText } from "../essentialPii";

const redact = (text: string) => redactEssentialPiiInText({ text });

describe("redactEssentialPiiInText", () => {
  describe("given an email address", () => {
    it("redacts it", () => {
      const { text } = redact("contact test@example.com please");
      expect(text).toBe("contact [REDACTED] please");
    });
  });

  describe("given IP addresses", () => {
    it("redacts an IPv4 address", () => {
      expect(redact("from 192.168.0.1 today").text).toBe(
        "from [REDACTED] today",
      );
    });

    it("redacts an IPv6 address", () => {
      const { text } = redact("host fe80::1ff:fe23:4567:890a end");
      expect(text).toContain("[REDACTED]");
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
        "card [REDACTED] ok",
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
        "iban [REDACTED] here",
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
      expect(text).toContain("[REDACTED]");
      expect(text).not.toContain("12345678");
    });

    it("redacts a US number", () => {
      const { text } = redact("ring (415) 555-2671 today");
      expect(text).toContain("[REDACTED]");
    });
  });

  describe("given a bare nine-digit run", () => {
    it("leaves it intact without context", () => {
      const input = "ref 123456789 logged";
      expect(redact(input).text).toBe(input);
    });

    it("redacts it when an SSN context word is nearby", () => {
      const { text } = redact("SSN: 123456789 on file");
      expect(text).toContain("[REDACTED]");
      expect(text).not.toContain("123456789");
    });
  });

  describe("given a crypto wallet address", () => {
    it("redacts an Ethereum address", () => {
      const { text } = redact(
        "to 0x52908400098527886E0F7030069857D2E4169EE7 now",
      );
      expect(text).toContain("[REDACTED]");
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
    it("redacts each and counts them", () => {
      const { text, redactedCount } = redact(
        "mail test@example.com ip 10.0.0.1 card 4111111111111111",
      );
      expect(text).not.toContain("test@example.com");
      expect(text).not.toContain("10.0.0.1");
      expect(redactedCount).toBe(3);
    });
  });
});
