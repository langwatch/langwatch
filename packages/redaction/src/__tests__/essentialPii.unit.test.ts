import { describe, expect, it } from "vitest";

import { compilePiiExceptPatterns, redactEssentialPiiInText } from "../essentialPii.js";
import { subtractProtectedRanges } from "../essentialPii.js";

/**
 * Spec: packages/features/data-privacy/specs/span-pii-redaction.feature
 *
 * The native floor, exercised through its own entry point rather than through
 * the span service, because every sabotage that matters to a customer lands
 * here: a recognizer that stops firing, a checksum that stops rejecting, a
 * marker written without the original being removed.
 */

const redact = (text: string, options: Parameters<typeof redactEssentialPiiInText>[0] = { text }) =>
  redactEssentialPiiInText({ ...options, text });

describe("given free text carrying pattern-based identifiers", () => {
  /** @scenario "The essential level scrubs in process and calls nothing" */
  it("replaces each one with its own typed marker and removes the original", () => {
    const result = redact(
      "mail ana@example.com from 10.1.2.3 card 4111 1111 1111 1111 iban GB82WEST12345698765432 wallet 0x52908400098527886E0F7030069857D2E4169EE7",
    );

    expect(result.text).toContain("[EMAIL_ADDRESS]");
    expect(result.text).toContain("[IP_ADDRESS]");
    expect(result.text).toContain("[CREDIT_CARD]");
    expect(result.text).toContain("[IBAN_CODE]");
    expect(result.text).toContain("[CRYPTO]");
    expect(result.text).not.toContain("ana@example.com");
    expect(result.text).not.toContain("10.1.2.3");
    expect(result.text).not.toContain("4111 1111 1111 1111");
    expect(result.text).not.toContain("GB82WEST12345698765432");
    expect(result.text).not.toContain("0x52908400098527886E0F7030069857D2E4169EE7");
    expect(result.redactedCount).toBe(5);
  });

  /** @scenario "A checksum-backed identifier is not redacted on shape alone" */
  it("redacts a Brazilian CPF on its check digits alone, with no context word", () => {
    expect(redact("cpf 529.982.247-25").text).toBe("cpf [BR_CPF]");
  });

  /** @scenario "A checksum-backed identifier is not redacted on shape alone" */
  it("leaves an eleven-digit run whose CPF check digits do not add up", () => {
    expect(redact("ref 529.982.247-26").text).toBe("ref 529.982.247-26");
  });

  /** @scenario "A checksum-backed identifier is not redacted on shape alone" */
  it("leaves a card-shaped digit run that fails the Luhn check", () => {
    expect(redact("order 4111111111111112").text).toBe("order 4111111111111112");
  });

  /** @scenario "The essential level scrubs in process and calls nothing" */
  it("finds a phone number written as digits and separators", () => {
    const result = redact("call +1 415 555 2671 tomorrow");
    expect(result.text).toBe("call [PHONE_NUMBER] tomorrow");
  });
});

describe("given an identifier that is ambiguous without a nearby word", () => {
  /** @scenario "An ambiguous digit run needs a nearby word" */
  it("holds a bare nine-digit run back", () => {
    expect(redact("reference 123456789 shipped").text).toBe("reference 123456789 shipped");
  });

  /** @scenario "An ambiguous digit run needs a nearby word" */
  it("redacts the same run once the context word is present", () => {
    expect(redact("ssn 123456789").text).toBe("ssn [US_SSN]");
  });
});

describe("given one attribute value that is a machine identifier", () => {
  /** @scenario "One attribute value that is a machine identifier keeps its shape" */
  it("still redacts a self-proving finding inside it", () => {
    const result = redact("user-ana@example.com-1", { text: "", isAttributeValue: true });
    expect(result.text).toContain("[EMAIL_ADDRESS]");
  });

  /** @scenario "One attribute value that is a machine identifier keeps its shape" */
  it("does not read a digit run inside a longer token as a phone number", () => {
    const value = "hosted-eu-20260812-091234";
    expect(redact(value, { text: "", isAttributeValue: true }).text).toBe(value);
  });

  /** @scenario "One attribute value that is a machine identifier keeps its shape" */
  it("reads the same digits as a phone number in free text", () => {
    const result = redact("+31 6 12345678", { text: "", isAttributeValue: false });
    expect(result.text).toBe("[PHONE_NUMBER]");
  });
});

describe("given a policy exception covering a known-safe format", () => {
  const exceptions = compilePiiExceptPatterns(["ops@example\\.com"]);

  /** @scenario "A do-not-redact exception preserves its whole matched text" */
  it("leaves a finding whose whole matched text the exception covers", () => {
    const result = redact("write to ops@example.com", { text: "", exceptPatterns: exceptions });
    expect(result.text).toBe("write to ops@example.com");
    expect(result.redactedCount).toBe(0);
  });

  /** @scenario "A do-not-redact exception preserves its whole matched text" */
  it("still redacts a different finding of the same kind", () => {
    const result = redact("ops@example.com and ana@example.com", {
      text: "",
      exceptPatterns: exceptions,
    });
    expect(result.text).toBe("ops@example.com and [EMAIL_ADDRESS]");
  });

  /** @scenario "A do-not-redact exception preserves its whole matched text" */
  it("never lets an exception for a prefix carve a hole out of a longer identifier", () => {
    const prefixOnly = compilePiiExceptPatterns(["ops@"]);
    const result = redact("write to ops@example.com", { text: "", exceptPatterns: prefixOnly });
    expect(result.text).toBe("write to [EMAIL_ADDRESS]");
  });

  /** @scenario "A do-not-redact exception preserves its whole matched text" */
  it("skips a pattern that will not compile rather than failing ingestion", () => {
    expect(compilePiiExceptPatterns(["(unclosed", "ok"]).length).toBe(1);
  });
});

describe("given the custom level naming a subset of identifiers", () => {
  /** @scenario "A custom level sends only the identifiers it selected and the native engine cannot detect" */
  it("runs only the recognizers named", () => {
    const result = redact("ana@example.com from 10.1.2.3", {
      text: "",
      entities: ["EMAIL_ADDRESS"],
    });
    expect(result.text).toBe("[EMAIL_ADDRESS] from 10.1.2.3");
  });
});

describe("given text past the scan budget", () => {
  it("returns it untouched rather than spending the pass", () => {
    const huge = `${"a".repeat(250_001)} ana@example.com`;
    expect(redact(huge).redactedCount).toBe(0);
  });
});

describe("given a detected span overlapping a vetoed one", () => {
  it("masks only what falls outside the vetoed range", () => {
    expect(subtractProtectedRanges({ start: 0, end: 10 }, [{ start: 3, end: 6 }])).toEqual([
      { start: 0, end: 3 },
      { start: 6, end: 10 },
    ]);
  });

  it("masks the whole span when nothing is vetoed", () => {
    expect(subtractProtectedRanges({ start: 2, end: 5 }, [])).toEqual([{ start: 2, end: 5 }]);
  });
});
