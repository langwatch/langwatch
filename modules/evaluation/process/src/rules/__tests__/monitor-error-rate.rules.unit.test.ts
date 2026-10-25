/**
 * @vitest-environment node
 * @see modules/evaluation/specs/monitor-error-rate.feature
 */
import { describe, expect, it } from "vitest";

import {
  isMonitorErrorRateExceeded,
  MONITOR_ERROR_MESSAGE_MAX_LENGTH,
  normalizeMonitorErrorMessage,
} from "../monitor-error-rate.rules.ts";

describe("normalizeMonitorErrorMessage", () => {
  describe("when the message holds an API key, a bearer token and a URL with a password", () => {
    /** @scenario "The reported error message carries no secret" */
    it("redacts each of them", () => {
      const message = normalizeMonitorErrorMessage(
        "401 from https://acme:hunter2@llm.acme.example/v1 with Authorization: Bearer abc.def-123 and api_key=sk-test-aaaaaaaaaaaaaaaa",
      );

      expect(message).not.toContain("hunter2");
      expect(message).not.toContain("abc.def-123");
      expect(message).not.toContain("sk-test-aaaaaaaaaaaaaaaa");
      expect(message).toContain("[redacted]");
    });

    /** @scenario "The reported error message carries no secret" */
    it("keeps the message at most 160 characters long", () => {
      const message = normalizeMonitorErrorMessage(`Evaluator failed: ${"a reason ".repeat(80)}`);

      expect(message.length).toBeLessThanOrEqual(MONITOR_ERROR_MESSAGE_MAX_LENGTH);
      expect(message.endsWith("...")).toBe(true);
    });
  });

  describe("when the message is a JSON issue list", () => {
    /** @scenario "The reported error message is one short readable line" */
    it("carries the first issue's message, never the raw JSON", () => {
      const raw = JSON.stringify(
        [{ code: "invalid_union", path: ["mapping", "input"], message: "Invalid input" }],
        null,
        2,
      );

      expect(normalizeMonitorErrorMessage(raw)).toBe("Invalid input");
      expect(normalizeMonitorErrorMessage(`Mapping refused: ${raw}`)).toBe(
        "Mapping refused: Invalid input",
      );
    });

    /** @scenario "The reported error message is one short readable line" */
    it("names an error object that carries no message instead of dumping it", () => {
      expect(normalizeMonitorErrorMessage('{"code":"invalid_value","values":["a","b"]}')).toBe(
        "Evaluator returned an error object",
      );
    });
  });

  describe("when the message spans several lines", () => {
    /** @scenario "The reported error message is one short readable line" */
    it("keeps the first non-empty line", () => {
      expect(
        normalizeMonitorErrorMessage(
          "\nConnection reset by peer\n    at Socket.onclose (net.js:1)",
        ),
      ).toBe("Connection reset by peer");
    });
  });

  it("folds ids and long numbers so the same failure reads as one message", () => {
    expect(
      normalizeMonitorErrorMessage("Request 8c9f2a1e-1b2c-4d5e-8f90-123456789abc took 120000 ms"),
    ).toBe(
      normalizeMonitorErrorMessage("Request 0f1e2d3c-4b5a-4968-8776-fedcba987654 took 130000 ms"),
    );
  });
});

describe("isMonitorErrorRateExceeded", () => {
  it("needs at least 50 runs and 90% of them errors", () => {
    expect(isMonitorErrorRateExceeded({ runs: 50, errors: 45 })).toBe(true);
    expect(isMonitorErrorRateExceeded({ runs: 49, errors: 49 })).toBe(false);
    expect(isMonitorErrorRateExceeded({ runs: 100, errors: 89 })).toBe(false);
  });
});
