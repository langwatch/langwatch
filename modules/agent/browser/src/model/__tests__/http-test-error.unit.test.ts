import { describe, expect, it } from "vitest";

import { explainTestError } from "../http-test-error.ts";

describe("explainTestError", () => {
  describe("given a test the engine refused with a code the registry knows", () => {
    /** @scenario "A refused HTTP agent test reads in words, never the code" */
    it("reads the registry's words instead of the code", () => {
      const explanation = explainTestError({ errorCode: "ssrf_blocked", error: "ssrf_blocked" });

      expect(explanation.title).toBe("That address isn't allowed");
      expect(explanation.title).not.toContain("ssrf_blocked");
    });
  });

  describe("given a failure with no code or an unknown one", () => {
    /** @scenario "A refused HTTP agent test reads in words, never the code" */
    it("keeps the generic title", () => {
      expect(explainTestError({ error: "boom" }).title).toBe("The test request failed");
      expect(explainTestError({ errorCode: "not_a_known_code" }).title).toBe(
        "The test request failed",
      );
    });
  });
});
