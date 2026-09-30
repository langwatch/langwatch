/**
 * @vitest-environment node
 *
 * @see specs/ops/health-probe-cause.feature
 */
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import { deriveProbeCause } from "../probe-cause.rules.ts";

class FakeHandledError extends HandledError {}

describe("deriveProbeCause", () => {
  describe("given a serialized Langy turn error chain ending in insufficient_quota", () => {
    describe("when the cause is read", () => {
      /** @scenario "A typed error chain reports its innermost code" */
      it("reports insufficient_quota", () => {
        const turnError = JSON.stringify({
          code: "langy_agent_errored",
          kind: "langy_agent_errored",
          httpStatus: 502,
          reasons: [
            {
              code: "llm_upstream_error",
              meta: { body_kind: "json" },
              reasons: [{ code: "insufficient_quota", kind: "insufficient_quota" }],
            },
          ],
        });

        expect(deriveProbeCause(turnError)).toBe("insufficient_quota");
      });

      it("reads a live HandledError chain the same way", () => {
        const error = new FakeHandledError("langy_agent_errored", "Agent errored.", {
          reasons: [new FakeHandledError("auth_upstream_unavailable", "Control plane down.")],
        });

        expect(deriveProbeCause(error)).toBe("auth_upstream_unavailable");
      });
    });
  });

  describe("given a chain whose innermost reason carries no code", () => {
    describe("when the cause is read", () => {
      /** @scenario "A chain whose innermost link has no code reports the nearest code above it" */
      it("reports the nearest code above it", () => {
        const error = new FakeHandledError("llm_upstream_error", "Upstream failed.", {
          reasons: [new Error("socket hang up")],
        });

        expect(deriveProbeCause(error)).toBe("llm_upstream_error");
      });
    });
  });

  describe("given a scenario run error that carries the provider message as prose", () => {
    describe("when the cause is read", () => {
      /** @scenario "A provider message in prose is matched to its code" */
      it("reports insufficient_quota", () => {
        const runError = JSON.stringify({
          name: "Error",
          message:
            "[UserSimulatorAgent] AI_RetryError: Failed after 3 attempts. Last error: You have no credits remaining. Add credits to continue using the API.",
          stack: "Error: ...",
        });

        expect(deriveProbeCause(runError)).toBe("insufficient_quota");
      });

      it("matches a gateway budget refusal", () => {
        expect(deriveProbeCause(new Error("402 budget_exceeded: monthly cap"))).toBe(
          "budget_exceeded",
        );
      });
    });
  });

  describe("given a failure with nothing code-shaped in it", () => {
    describe("when the cause is read", () => {
      /** @scenario "A failure with nothing code-shaped in it has no cause" */
      it("has no cause", () => {
        expect(deriveProbeCause("boom")).toBeUndefined();
        expect(deriveProbeCause(new Error("Agent not configured"))).toBeUndefined();
        expect(deriveProbeCause(null)).toBeUndefined();
        expect(deriveProbeCause({ code: "unknown" })).toBeUndefined();
      });
    });
  });

  describe("given a typed error whose code is not a code", () => {
    describe("when the cause is read", () => {
      /** @scenario "A cause is never a message" */
      it("has no cause", () => {
        expect(deriveProbeCause({ code: "Invalid key sk-live-123 for https://x" })).toBeUndefined();
        expect(deriveProbeCause({ code: `a${"b".repeat(64)}` })).toBeUndefined();
      });

      it("lowercases an errno-style code", () => {
        expect(deriveProbeCause({ code: "ECONNREFUSED" })).toBe("econnrefused");
      });
    });
  });
});
