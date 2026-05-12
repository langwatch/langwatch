import { describe, expect, it } from "vitest";
import { classifyGenerationError } from "../classifyGenerationError";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal TRPCClientError-shaped object (without importing the real class). */
function makeTrpcError(message: string, dataMessage?: string): Error & { data?: { message?: string } } {
  const err = new Error(message) as Error & { data?: { message?: string } };
  if (dataMessage !== undefined) {
    err.data = { message: dataMessage };
  }
  return err;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("classifyGenerationError", () => {
  // ── config tier ────────────────────────────────────────────────────────────

  describe("given an error matching /no default model/", () => {
    it("returns config tier with configure CTA", () => {
      const result = classifyGenerationError(new Error("No default model set for this project"));

      expect(result.tier).toBe("config");
      expect(result.cta).toBe("configure");
      expect(result.copy).toContain("no default model");
    });
  });

  describe("given an error matching /no.*provider/", () => {
    it("returns config tier with configure CTA", () => {
      const result = classifyGenerationError(new Error("No provider found for this project"));

      expect(result.tier).toBe("config");
      expect(result.cta).toBe("configure");
    });
  });

  describe("given an error matching /provider.*not.*configured/", () => {
    it("returns config tier with configure CTA", () => {
      const result = classifyGenerationError(new Error("Provider is not configured"));

      expect(result.tier).toBe("config");
      expect(result.cta).toBe("configure");
    });
  });

  describe("given an error matching /stale/", () => {
    it("returns config tier with configure CTA", () => {
      const result = classifyGenerationError(new Error("Stale provider reference detected"));

      expect(result.tier).toBe("config");
      expect(result.cta).toBe("configure");
      expect(result.copy).toContain("provider is disabled");
    });
  });

  describe("given an error matching /provider.*disabled/", () => {
    it("returns config tier with configure CTA", () => {
      const result = classifyGenerationError(new Error("The provider has been disabled"));

      expect(result.tier).toBe("config");
      expect(result.cta).toBe("configure");
    });
  });

  // ── auth tier ──────────────────────────────────────────────────────────────

  describe("given an Error with message matching /invalid api key/", () => {
    it("returns auth tier with configure CTA", () => {
      const result = classifyGenerationError(new Error("Invalid API key provided"));

      expect(result.tier).toBe("auth");
      expect(result.cta).toBe("configure");
      expect(result.copy).toContain("API key");
    });
  });

  describe("given an error matching /authentication/", () => {
    it("returns auth tier", () => {
      const result = classifyGenerationError(new Error("Authentication failed"));

      expect(result.tier).toBe("auth");
      expect(result.cta).toBe("configure");
    });
  });

  describe("given an error matching /unauthorized/", () => {
    it("returns auth tier", () => {
      const result = classifyGenerationError(new Error("401 Unauthorized"));

      expect(result.tier).toBe("auth");
      expect(result.cta).toBe("configure");
    });
  });

  // ── rate-limit tier ────────────────────────────────────────────────────────

  describe("given an error matching /rate limit/", () => {
    it("returns rate-limit tier with configure-and-retry CTA", () => {
      const result = classifyGenerationError(new Error("You have exceeded the rate limit"));

      expect(result.tier).toBe("rate-limit");
      expect(result.cta).toBe("configure-and-retry");
    });
  });

  describe("given an error matching /quota/", () => {
    it("returns rate-limit tier", () => {
      const result = classifyGenerationError(new Error("Quota exceeded for this period"));

      expect(result.tier).toBe("rate-limit");
      expect(result.cta).toBe("configure-and-retry");
    });
  });

  // ── timeout tier ───────────────────────────────────────────────────────────

  describe("given an error matching /timeout/", () => {
    it("returns timeout tier with retry CTA", () => {
      const result = classifyGenerationError(new Error("The request timed out"));

      expect(result.tier).toBe("timeout");
      expect(result.cta).toBe("retry");
    });
  });

  // ── unknown tier ───────────────────────────────────────────────────────────

  describe("given an Error with an unrecognised message", () => {
    it("returns unknown tier with retry-or-skip CTA and preserves raw message", () => {
      const result = classifyGenerationError(new Error("Unexpected internal server error"));

      expect(result.tier).toBe("unknown");
      expect(result.cta).toBe("retry-or-skip");
      if (result.tier === "unknown") {
        expect(result.rawMessage).toBe("Unexpected internal server error");
      }
    });
  });

  // ── input shape variants ───────────────────────────────────────────────────

  describe("given a TRPCClientError shape with data.message", () => {
    it("extracts message from data.message", () => {
      const err = makeTrpcError("Outer wrapper message", "Invalid API key from provider");
      const result = classifyGenerationError(err);

      // data.message takes priority — matches auth tier
      expect(result.tier).toBe("auth");
    });
  });

  describe("given a TRPCClientError shape without data.message", () => {
    it("falls back to error.message", () => {
      const err = makeTrpcError("Invalid API key from error.message");
      const result = classifyGenerationError(err);

      expect(result.tier).toBe("auth");
    });
  });

  describe("given a plain string error", () => {
    it("treats the string as the message", () => {
      const result = classifyGenerationError("rate limit exceeded");

      expect(result.tier).toBe("rate-limit");
    });
  });

  describe("given an unknown non-Error value", () => {
    it("returns unknown tier with string-coerced raw message", () => {
      const result = classifyGenerationError({ code: 500 });

      expect(result.tier).toBe("unknown");
      if (result.tier === "unknown") {
        expect(result.rawMessage).toBe("[object Object]");
      }
    });
  });

  describe("given case-insensitive matching", () => {
    it("matches INVALID API KEY in upper case", () => {
      const result = classifyGenerationError(new Error("INVALID API KEY"));

      expect(result.tier).toBe("auth");
    });
  });
});
