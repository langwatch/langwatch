import { describe, expect, it } from "vitest";

import { ScenarioGenerationError } from "@langwatch/scenario-web";
import { classifyGenerationError } from "../classifyGenerationError";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** A tRPC-shaped client error carrying a handled payload under `data.error`. */
function trpcHandledError(code: string, meta: Record<string, unknown> = {}) {
  return Object.assign(new Error(code), {
    data: { error: { code, httpStatus: 400, meta, fault: "customer" } },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("classifyGenerationError", () => {
  describe("given a handled failure the generate endpoint forwarded", () => {
    describe("when the code names a missing model provider", () => {
      it("asks the user to configure, whatever the message says", () => {
        const result = classifyGenerationError(
          new ScenarioGenerationError("no_provider_configured", "no_provider_configured"),
        );

        expect(result.tier).toBe("config");
        expect(result.cta).toBe("configure");
      });

      it("takes its words from the registry rather than the wire message", () => {
        const result = classifyGenerationError(
          new ScenarioGenerationError("no_provider_configured", "no_provider_configured"),
        );

        expect(result.title).toBe("No model provider configured");
        expect(result.copy).toBe("Add a provider in settings to continue.");
      });
    });

    describe("when the code names a rejected credential", () => {
      it("returns the auth tier with the registry's key copy", () => {
        const result = classifyGenerationError(
          new ScenarioGenerationError("invalid_api_key", "invalid_api_key"),
        );

        expect(result.tier).toBe("auth");
        expect(result.cta).toBe("configure");
        expect(result.title).toBe("That API key isn't valid");
      });
    });

    describe("when the code names a rate limit", () => {
      it("offers both waiting and configuring", () => {
        const result = classifyGenerationError(
          new ScenarioGenerationError("rate_limited", "rate_limited"),
        );

        expect(result.tier).toBe("rate-limit");
        expect(result.cta).toBe("configure-and-retry");
        expect(result.title).toBe("Too many requests");
      });
    });

    describe("when the code names a provider timeout", () => {
      it("offers a retry", () => {
        const result = classifyGenerationError(
          new ScenarioGenerationError("provider_timeout", "provider_timeout"),
        );

        expect(result.tier).toBe("timeout");
        expect(result.cta).toBe("retry");
        expect(result.title).toBe("The model provider timed out");
      });
    });

    describe("when the code carries meta the registry reads", () => {
      it("passes the meta through so the copy can use it", () => {
        const result = classifyGenerationError(
          new ScenarioGenerationError("llm_error", "llm_error", {
            upstreamStatus: 401,
          }),
        );

        expect(result.copy).toBe(
          "Check the API key for this model provider, then run again.",
        );
      });
    });

    describe("when the code is one this client has no copy for", () => {
      it("degrades to the humanised code rather than the raw message", () => {
        const result = classifyGenerationError(
          new ScenarioGenerationError("dataset_import_stalled", "dataset_import_stalled"),
        );

        expect(result.tier).toBe("unknown");
        expect(result.cta).toBe("retry-or-skip");
        expect(result.title).toBe("Dataset import stalled");
      });
    });
  });

  describe("given a handled failure that arrived over tRPC", () => {
    describe("when the envelope carries the code", () => {
      it("classifies on the code, not on prose", () => {
        const result = classifyGenerationError(trpcHandledError("budget_exceeded"));

        expect(result.tier).toBe("rate-limit");
        expect(result.cta).toBe("configure-and-retry");
        expect(result.title).toBe("You've reached your spending limit");
      });
    });
  });

  describe("given a failure with no handled payload", () => {
    describe("when the message reads like a classifiable one", () => {
      // The old classifier ran a regex ladder over the message, so any string
      // mentioning "rate limit" or "no default model" was promoted to a tier it
      // had not earned — and since #5984 that message is usually a code slug or
      // an internal, neither of which is a customer's to read.
      it("stays in the unknown tier instead of guessing from prose", () => {
        const result = classifyGenerationError(
          new Error("You have exceeded the rate limit"),
        );

        expect(result.tier).toBe("unknown");
        expect(result.cta).toBe("retry-or-skip");
      });

      it("never surfaces the raw message as copy", () => {
        const result = classifyGenerationError(
          new Error("ECONNREFUSED 10.0.0.1:5561 while calling the gateway"),
        );

        expect(result.title).toBe("Something went wrong");
        expect(result.copy).toBe("We've been notified. Try again in a moment.");
      });
    });

    describe("when the value isn't an Error at all", () => {
      it("still returns readable copy rather than a stringified object", () => {
        const result = classifyGenerationError({ code: 500 });

        expect(result.tier).toBe("unknown");
        expect(result.title).toBe("Something went wrong");
        expect(result.copy).not.toContain("[object Object]");
      });
    });
  });
});
