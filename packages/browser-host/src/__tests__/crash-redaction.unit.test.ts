import { describe, expect, it } from "vitest";

import { redactCrashError, redactCrashText } from "../telemetry/crash-redaction.ts";

const redact = (text: string) => redactCrashText({ text, limit: 500 });

describe("redactCrashText", () => {
  describe("given a crash message that quotes a secret", () => {
    /** @scenario "Telemetry: a chart or a board header action that crashes while drawing is reported as an exception" */
    it("masks a bearer token, an sk- key and a key=value secret", () => {
      expect(redact("Authorization failed: Bearer abc.def.ghi")).toBe(
        "Authorization failed: Bearer [redacted]",
      );
      expect(redact("bad key sk-lw-0123456789abcdef")).toBe("bad key [redacted]");
      expect(redact("url?api_key=hunter2&x=1")).toBe("url?api_key=[redacted]&x=1");
      expect(redact('{"token": "s3cr3t"}')).toBe('{"token": "[redacted]"}');
    });

    /** @scenario "Telemetry: a chart or a board header action that crashes while drawing is reported as an exception" */
    it("masks an email, a long hex run and a long base64 run", () => {
      expect(redact("user ada@example.com not found")).toBe("user [email] not found");
      expect(redact(`hash ${"a1".repeat(20)} differs`)).toBe("hash [redacted] differs");
      expect(redact(`payload ${"QmFzZTY0"}${"x9Y".repeat(14)}== end`)).toBe(
        "payload [redacted] end",
      );
    });
  });

  describe("given an ordinary crash message", () => {
    /** @scenario "Telemetry: a chart or a board header action that crashes while drawing is reported as an exception" */
    it("leaves it as it was", () => {
      expect(redact("Cannot read properties of undefined (reading 'x')")).toBe(
        "Cannot read properties of undefined (reading 'x')",
      );
    });
  });

  describe("given a message longer than the limit", () => {
    /** @scenario "Telemetry: a chart or a board header action that crashes while drawing is reported as an exception" */
    it("cuts it and says so", () => {
      expect(redactCrashText({ text: "x ".repeat(10), limit: 6 })).toBe("x x x  [truncated]");
    });
  });
});

describe("redactCrashError", () => {
  describe("given an error whose message and stack carry a token", () => {
    /** @scenario "Telemetry: a chart or a board header action that crashes while drawing is reported as an exception" */
    it("keeps its name and frames and masks the token in both", () => {
      const error = new TypeError("token=abc123 rejected");
      error.stack = `TypeError: token=abc123 rejected\n    at draw (https://app.example.com/a.js:3:4)`;

      const redacted = redactCrashError(error);

      expect(redacted.name).toBe("TypeError");
      expect(redacted.message).toBe("token=[redacted] rejected");
      expect(redacted.stack).toBe(
        "TypeError: token=[redacted] rejected\n    at draw (https://app.example.com/a.js:3:4)",
      );
    });
  });

  describe("given a crash reported as a string", () => {
    /** @scenario "Telemetry: a chart or a board header action that crashes while drawing is reported as an exception" */
    it("becomes an Error with the redacted text and no stack", () => {
      const redacted = redactCrashError("ada@example.com");

      expect(redacted).toBeInstanceOf(Error);
      expect(redacted.message).toBe("[email]");
      expect(redacted.stack).toBeUndefined();
    });
  });
});
