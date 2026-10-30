import { describe, expect, it } from "vitest";

import { redactEssentialPiiInText } from "../essentialPii.ts";

/** The pattern the email recognizer used to run; the scan must find exactly its matches. */
const PREVIOUS_EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const redactEmails = (text: string) =>
  redactEssentialPiiInText({ text, entities: ["EMAIL_ADDRESS"] }).text;

const previousRedaction = (text: string) => text.replace(PREVIOUS_EMAIL_PATTERN, "[EMAIL_ADDRESS]");

/** Deterministic text over an alphabet dense in the characters the pattern cares about. */
function randomText({ seed, length }: { seed: number; length: number }): string {
  const alphabet = "aZ09._%+-@@..@ -_xyzcom/:";
  let state = seed;
  let text = "";
  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) % 2147483648;
    text += alphabet[state % alphabet.length];
  }
  return text;
}

describe("given text holding addresses", () => {
  describe("when addresses sit packed against each other and against look-alikes", () => {
    /** @scenario "An address is redacted exactly where the old pattern found one" */
    it.each([
      "ada@example.com",
      "a@b.co.uk and c@d",
      "ada@example.com.x@evil.org",
      "x@y@z.com",
      "first.last+tag@sub.example.io,second@ex.am.ple",
      "@@a@b.cc@@",
      "no-tld@host and dots@a.b.c.d.e1",
      "user%x@ex-ample.org. trailing",
      "a_b@c.de@f.gh",
    ])("redacts the same addresses in %j", (text) => {
      expect(redactEmails(text)).toBe(previousRedaction(text));
    });

    /** @scenario "An address is redacted exactly where the old pattern found one" */
    it("redacts the same addresses across generated text", () => {
      for (let seed = 1; seed <= 400; seed++) {
        const text = randomText({ seed, length: 200 });
        expect(redactEmails(text), text).toBe(previousRedaction(text));
      }
    });
  });
});

describe("given the largest value redaction scans", () => {
  describe("when it is one long run of letters and digits beside an address marker", () => {
    /** @scenario "A large value beside an address marker does not hold up the worker" */
    it("finishes in well under a second", () => {
      const run = "deadbeefA1b2-_".repeat(17_800);
      const shapes = [
        `contact @ "${run}"`,
        `${run}@`,
        `x@${"ab.".repeat(80_000)}1`,
        `${run}@${run.slice(0, 10_000)}`,
      ];
      for (const text of shapes) {
        const startedAt = performance.now();
        redactEmails(text);
        expect(performance.now() - startedAt, text.slice(0, 40)).toBeLessThan(1_000);
      }
    });
  });
});
