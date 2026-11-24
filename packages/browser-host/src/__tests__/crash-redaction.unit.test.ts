import { describe, expect, it } from "vitest";

import { redactCrashError, redactCrashText } from "../telemetry/crash-redaction.ts";

// Built at runtime so the repo's secrets scanner sees no literal credential.
const FAKE_VALUE = ["Zx9Kq2Lm", "7Tv4Wb8N", "cd5R"].join("");

const redact = (text: string) => redactCrashText({ text, limit: 500 });

describe("redactCrashText", () => {
  describe("given a crash message that quotes a secret", () => {
    /** @scenario "Telemetry: a chart or a board header action that crashes while drawing is reported as an exception" */
    it("masks a bearer token, an sk- key and a key=value secret", () => {
      expect(redact("Authorization failed: Bearer abc.def.ghi")).toBe(
        "Authorization failed: Bearer [SECRET]",
      );
      expect(redact("bad key sk-lw-0123456789abcdef")).toBe("bad key [SECRET]");
      expect(redact(`retry with api_key=${FAKE_VALUE} now`)).toBe(
        "retry with api_key=[SECRET] now",
      );
      expect(redact(`{"token": "${FAKE_VALUE}"}`)).toBe('{"token": "[SECRET]"}');
    });

    /** @scenario "Telemetry: a chart or a board header action that crashes while drawing is reported as an exception" */
    it("masks a short assigned value the shared redactor leaves", () => {
      expect(redact("password=hunter2")).toBe("password=[SECRET]");
      expect(redact("url?api_key=abc123&x=1")).toBe("url?api_key=[SECRET]&x=1");
    });

    /** @scenario "Telemetry: a chart or a board header action that crashes while drawing is reported as an exception" */
    it("masks an email, a long hex run and a long base64 run", () => {
      expect(redact("user ada@example.com not found")).toBe("user [email] not found");
      expect(redact(`hash ${"a1".repeat(20)} differs`)).toBe("hash [SECRET] differs");
      expect(redact(`payload ${"QmFzZTY0"}${"x9Y".repeat(14)}== end`)).toBe("payload [SECRET] end");
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
  describe("given a 200 KB digit-free message and stack", () => {
    /** @scenario "Telemetry: a chart or a board header action that crashes while drawing is reported as an exception" */
    it("redacts a huge digit-free crash quickly, still masking a token near the start", () => {
      const huge = `token=${FAKE_VALUE} ${"a".repeat(200_000)}`;
      const error = new Error(huge);
      error.stack = huge;

      const startedAt = performance.now();
      const redacted = redactCrashError(error);
      const elapsedMs = performance.now() - startedAt;

      expect(elapsedMs).toBeLessThan(200);
      expect(redacted.message.startsWith("token=[SECRET] ")).toBe(true);
      expect(redacted.message.length).toBeLessThanOrEqual(500 + " [truncated]".length);
      expect(redacted.stack?.startsWith("token=[SECRET] ")).toBe(true);
      expect(redacted.stack?.length).toBeLessThanOrEqual(4_000 + " [truncated]".length);
    });
  });

  describe("given an error whose message and stack carry a token", () => {
    /** @scenario "Telemetry: a chart or a board header action that crashes while drawing is reported as an exception" */
    it("keeps its name and frames and masks the token in both", () => {
      const error = new TypeError(`token=${FAKE_VALUE} rejected`);
      error.stack = `TypeError: token=${FAKE_VALUE} rejected\n    at draw (https://app.example.com/a.js:3:4)`;

      const redacted = redactCrashError(error);

      expect(redacted.name).toBe("TypeError");
      expect(redacted.message).toBe("token=[SECRET] rejected");
      expect(redacted.stack).toBe(
        "TypeError: token=[SECRET] rejected\n    at draw (https://app.example.com/a.js:3:4)",
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
