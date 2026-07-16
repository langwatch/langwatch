import { describe, expect, it } from "vitest";
import { SECRETS_REDACTION_MARKER } from "~/server/data-privacy/redaction/secretsRedaction";
import {
  DispatchError,
  extractHttpStatus,
  isDispatchError,
  isProviderTerminal,
  isRetryableHttpStatus,
  MAX_CAUSE_MESSAGE_LENGTH,
  toDispatchError,
} from "../dispatchError";

describe("DispatchError", () => {
  describe("when constructed", () => {
    it("captures message, retryable flag, and cause", () => {
      const cause = new Error("inner");
      const err = new DispatchError({
        message: "outer",
        retryable: false,
        cause,
      });
      expect(err.message).toBe("outer");
      expect(err.retryable).toBe(false);
      expect(err.cause).toBe(cause);
      expect(err.name).toBe("DispatchError");
    });

    it("identifies as a real Error", () => {
      const err = new DispatchError({ message: "x", retryable: true });
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(DispatchError);
    });

    it("carries the disposition when one is given", () => {
      const err = new DispatchError({
        message: "x",
        retryable: false,
        disposition: "provider_terminal",
      });
      expect(err.disposition).toBe("provider_terminal");
    });

    it("leaves the disposition absent when none is given", () => {
      const err = new DispatchError({ message: "x", retryable: false });
      expect(err.disposition).toBeUndefined();
    });
  });
});

describe("isProviderTerminal", () => {
  describe("when the failure is a non-retryable provider verdict", () => {
    it("returns true", () => {
      expect(
        isProviderTerminal(
          new DispatchError({
            message: "revoked webhook",
            retryable: false,
            disposition: "provider_terminal",
          }),
        ),
      ).toBe(true);
    });
  });

  describe("when the failure is a non-retryable config error", () => {
    it("returns false so the queue parks it rather than dead-lettering it", () => {
      expect(
        isProviderTerminal(
          new DispatchError({
            message: "invalid slack url",
            retryable: false,
            disposition: "config",
          }),
        ),
      ).toBe(false);
    });

    it("returns false when the disposition was never classified", () => {
      expect(
        isProviderTerminal(
          new DispatchError({
            message: "mixed cadence batch",
            retryable: false,
          }),
        ),
      ).toBe(false);
    });
  });

  describe("when the failure is retryable or not a DispatchError", () => {
    it("returns false", () => {
      expect(
        isProviderTerminal(
          new DispatchError({
            message: "429",
            retryable: true,
            disposition: "provider_terminal",
          }),
        ),
      ).toBe(false);
      expect(isProviderTerminal(new Error("plain"))).toBe(false);
      expect(isProviderTerminal(null)).toBe(false);
    });
  });
});

describe("isDispatchError", () => {
  describe("when given a DispatchError instance", () => {
    it("returns true", () => {
      expect(
        isDispatchError(new DispatchError({ message: "x", retryable: true })),
      ).toBe(true);
    });
  });

  describe("when given anything else", () => {
    it("returns false", () => {
      expect(isDispatchError(new Error("plain"))).toBe(false);
      expect(isDispatchError("string-error")).toBe(false);
      expect(isDispatchError(null)).toBe(false);
      expect(isDispatchError(undefined)).toBe(false);
      expect(isDispatchError({ retryable: true })).toBe(false);
    });
  });
});

describe("isRetryableHttpStatus", () => {
  describe("when the status is a rate limit or server error", () => {
    it("returns true for 429 and 5xx", () => {
      expect(isRetryableHttpStatus(429)).toBe(true);
      expect(isRetryableHttpStatus(500)).toBe(true);
      expect(isRetryableHttpStatus(503)).toBe(true);
    });
  });

  describe("when the status is a client error other than 429", () => {
    it("returns false", () => {
      expect(isRetryableHttpStatus(400)).toBe(false);
      expect(isRetryableHttpStatus(404)).toBe(false);
      expect(isRetryableHttpStatus(410)).toBe(false);
    });
  });
});

describe("extractHttpStatus", () => {
  describe("when the error carries a status in a known shape", () => {
    it("reads the AWS SDK v3 metadata status", () => {
      expect(extractHttpStatus({ $metadata: { httpStatusCode: 500 } })).toBe(
        500,
      );
    });

    it("reads an axios/@slack/webhook nested response status", () => {
      expect(
        extractHttpStatus({ original: { response: { status: 404 } } }),
      ).toBe(404);
    });

    it("reads a numeric SendGrid code", () => {
      expect(extractHttpStatus({ code: 429 })).toBe(429);
    });
  });

  describe("when the error carries no recognizable status", () => {
    it("ignores string transport codes and returns undefined", () => {
      expect(extractHttpStatus({ code: "ECONNREFUSED" })).toBeUndefined();
      expect(extractHttpStatus(new Error("boom"))).toBeUndefined();
      expect(extractHttpStatus("nope")).toBeUndefined();
      expect(extractHttpStatus(null)).toBeUndefined();
    });
  });
});

describe("toDispatchError", () => {
  describe("when given an existing DispatchError", () => {
    it("returns it unchanged", () => {
      const original = new DispatchError({ message: "x", retryable: false });
      expect(toDispatchError(original, { message: "wrapped" })).toBe(original);
    });
  });

  describe("when the failure has a retryable status", () => {
    it("produces a retryable DispatchError with the status in the message", () => {
      const err = toDispatchError(
        { $metadata: { httpStatusCode: 503 } },
        { message: "send failed" },
      );
      expect(err).toBeInstanceOf(DispatchError);
      expect(err.retryable).toBe(true);
      expect(err.message).toBe("send failed: HTTP 503");
    });
  });

  describe("when the failure has a terminal status", () => {
    it("produces a non-retryable DispatchError", () => {
      const err = toDispatchError(
        { response: { status: 404 } },
        { message: "send failed" },
      );
      expect(err.retryable).toBe(false);
      expect(err.message).toBe("send failed: HTTP 404");
    });

    it("marks it provider-terminal, because the provider itself returned the verdict", () => {
      const err = toDispatchError(
        { response: { status: 404 } },
        { message: "send failed" },
      );
      expect(err.disposition).toBe("provider_terminal");
      expect(isProviderTerminal(err)).toBe(true);
    });
  });

  describe("when the caller declares the failure non-retryable itself", () => {
    it("marks it config, so a broken invariant is never dead-lettered as a provider verdict", () => {
      const err = toDispatchError(new Error("invalid slack webhook url"), {
        message: "guard rejected",
        retryable: false,
      });
      expect(err.retryable).toBe(false);
      expect(err.disposition).toBe("config");
      expect(isProviderTerminal(err)).toBe(false);
    });

    it("stays config even when a terminal status is also present", () => {
      // The override wins the retryable decision, so it must own the
      // disposition too — otherwise a caller-classified config failure would
      // inherit provider-terminal treatment from an incidental status.
      const err = toDispatchError(
        Object.assign(new Error("rejected"), { response: { status: 400 } }),
        { message: "guard rejected", retryable: false },
      );
      expect(err.disposition).toBe("config");
      expect(isProviderTerminal(err)).toBe(false);
    });
  });

  describe("when a retryable failure is classified", () => {
    it("is never provider-terminal", () => {
      const err = toDispatchError(
        { response: { status: 503 } },
        { message: "send failed" },
      );
      expect(isProviderTerminal(err)).toBe(false);
    });
  });

  describe("when the failure has no recognizable status", () => {
    it("defaults to retryable and preserves the cause", () => {
      const cause = new Error("connection refused");
      const err = toDispatchError(cause, { message: "send failed" });
      expect(err.retryable).toBe(true);
      expect(err.cause).toBe(cause);
    });
  });

  describe("when the failure carries both a status and a provider message", () => {
    it("includes both in the message so logs are diagnosable without the cause", () => {
      const cause = Object.assign(
        new Error("An HTTP protocol error occurred: statusCode = 404"),
        { original: { response: { status: 404 } } },
      );
      const err = toDispatchError(cause, { message: "send failed" });
      expect(err.message).toBe(
        "send failed: HTTP 404 — An HTTP protocol error occurred: statusCode = 404",
      );
    });

    it("keeps the detail when the caller overrides retryable", () => {
      const err = toDispatchError(new Error("template exploded"), {
        message: "render failed",
        retryable: false,
      });
      expect(err.retryable).toBe(false);
      expect(err.message).toBe("render failed: template exploded");
    });

    it("caps an oversized provider message at exactly the cause limit, ellipsis included", () => {
      const err = toDispatchError(new Error("x".repeat(2000)), {
        message: "send failed",
      });
      const cause = err.message.replace("send failed: ", "");
      expect(cause).toHaveLength(MAX_CAUSE_MESSAGE_LENGTH);
      expect(cause.endsWith("…")).toBe(true);
      expect(cause).toBe("x".repeat(MAX_CAUSE_MESSAGE_LENGTH - 1) + "…");
    });

    it("leaves a message at the cap untouched rather than truncating it", () => {
      const exact = "x".repeat(MAX_CAUSE_MESSAGE_LENGTH);
      const err = toDispatchError(new Error(exact), {
        message: "send failed",
      });
      expect(err.message).toBe(`send failed: ${exact}`);
    });
  });

  describe("when the provider echoes a secret back in its error message", () => {
    it("redacts the secret before it can reach logs or audit rows", () => {
      const err = toDispatchError(
        new Error(
          'request failed: {"authorization":"Bearer sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA"}',
        ),
        { message: "send failed" },
      );
      expect(err.message).not.toContain(
        "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      );
      expect(err.message).toContain(SECRETS_REDACTION_MARKER);
    });

    it("redacts before capping, so a long body cannot smuggle a secret past the cap", () => {
      // The secret sits past the cap: redaction must run on the whole message
      // first, or truncation would simply hide (not scrub) it — and a slightly
      // shorter body would leak it verbatim.
      const err = toDispatchError(
        new Error(
          "padding ".repeat(20) +
            "xoxb-111111111111-222222222222-abcdefghijklmnopqrstuvwx",
        ),
        { message: "send failed" },
      );
      expect(err.message).not.toContain("xoxb-111111111111");
      expect(err.message).toContain(SECRETS_REDACTION_MARKER);
    });
  });

  describe("when the failure carries neither a status nor a message", () => {
    it("leaves the caller's message untouched", () => {
      const err = toDispatchError({ weird: true }, { message: "send failed" });
      expect(err.message).toBe("send failed");
    });
  });
});
