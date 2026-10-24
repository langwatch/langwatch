import { describe, expect, it } from "vitest";

import { explainTestError } from "../http-test-error.ts";

describe("explainTestError", () => {
  describe("given a test the engine refused with a code the registry knows", () => {
    /** @scenario "A refused HTTP agent test reads in words, never the code" */
    it("reads the registry's words instead of the code", () => {
      const explanation = explainTestError({ errorCode: "ssrf_blocked" });

      expect(explanation.title).toBe("That address isn't allowed");
      expect(explanation.title).not.toContain("ssrf_blocked");
    });
  });

  describe("given a failure with no code or an unknown one", () => {
    /** @scenario "A refused HTTP agent test reads in words, never the code" */
    it("keeps the generic title", () => {
      expect(explainTestError({}).title).toBe("The test request failed");
      expect(explainTestError({ errorCode: "not_a_known_code" }).title).toBe(
        "The test request failed",
      );
    });
  });

  describe("given each failure code the engine and the test service raise", () => {
    /** @scenario "Every failed HTTP agent test names its cause by a code with copy" */
    it.each([
      ["http_timeout", "The agent took too long to answer"],
      ["http_dns_error", "That address couldn't be found"],
      ["http_connection_refused", "The agent refused the connection"],
      ["http_tls_error", "A secure connection to the agent couldn't be made"],
      ["http_invalid_response", "The agent's answer couldn't be read"],
      ["http_error", "Couldn't reach the agent"],
      ["http_executor_unavailable", "HTTP requests are temporarily unavailable"],
    ])("reads %s in the registry's words, with what to do", (errorCode, title) => {
      const explanation = explainTestError({ errorCode });

      expect(explanation.title).toBe(title);
      expect(explanation.description).toBeTruthy();
    });

    it("reads a non-2xx answer with its status", () => {
      const explanation = explainTestError({ errorCode: "upstream_http_error", status: 503 });

      expect(explanation.title).not.toBe("The test request failed");
      expect(explanation.description).toBeTruthy();
    });
  });
});
