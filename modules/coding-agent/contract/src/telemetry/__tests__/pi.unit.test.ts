/**
 * Every span name and attribute key here is one pi 0.84.2 declares in
 * `@earendil-works/pi-agent-core`'s harness and AI telemetry schemas.
 */
import { describe, expect, it } from "vitest";

import {
  CODING_AGENT_CONTRIBUTION_KEYS,
  detectCodingAgent,
} from "../coding-agent-normalization.ts";
import { isModelCallSpan } from "../coding-agent-span.ts";
import { genAiOperationRoleOf, isSpanFedModelCall } from "../gen-ai-operations.ts";
import { CODING_AGENT_REGISTRY, SPAN_FED_MODEL_CALL_AGENT_IDS } from "../index.ts";
import { piAgent } from "../pi.ts";

/**
 * The keys the pi fold reads off a span. The allowlist is an exact-match
 * lookup that drops anything unlisted without erroring, so a removal here has
 * no runtime symptom: this test is the symptom.
 */
const PI_FOLD_KEYS = [
  "pi.session.id",
  "pi.turn.id",
  "pi.tool.name",
  "pi.tool.call_id",
  "pi.tool.is_error",
  "pi.ai.model",
  "pi.ai.provider",
  "pi.ai.response.model",
  "pi.ai.response.stop_reason",
  "pi.ai.error.type",
  "pi.ai.usage.input_tokens",
  "pi.ai.usage.output_tokens",
  "pi.ai.usage.cache_read_tokens",
  "pi.ai.usage.cache_write_tokens",
  "pi.ai.usage.reasoning_tokens",
  "pi.ai.usage.total_tokens",
  "pi.ai.usage.cost",
  "pi.error.code",
  "pi.error.type",
  "pi.operation.kind",
  "pi.operation.outcome",
  "pi.compaction.reason",
];

describe("the pi coding-agent definition", () => {
  it("is registered, exactly once", () => {
    expect(CODING_AGENT_REGISTRY.filter((agent) => agent.id === "pi")).toHaveLength(1);
  });

  describe("when matching a signal", () => {
    it("claims a record named pi.*", () => {
      expect(detectCodingAgent({ recordName: "pi.harness.run" })).toBe("pi");
      expect(detectCodingAgent({ recordName: "pi.ai.request" })).toBe("pi");
    });

    /**
     * `pi` is a substring of both `copilot` and `anthropic`, so a
     * `signalSays(signal, "pi")` predicate would claim either agent's signals.
     */
    it("claims neither copilot's nor Claude Code's signals", () => {
      expect(
        piAgent.matches({ name: "chat gpt-5", scope: "github.copilot", service: "copilot" }),
      ).toBe(false);
      expect(
        piAgent.matches({
          name: "claude_code.llm_request",
          scope: "com.anthropic.claude_code.events",
          service: "anthropic",
        }),
      ).toBe(false);
    });
  });

  describe("when naming the session roles", () => {
    it("names each role by pi's own span name, which carries no space", () => {
      expect(genAiOperationRoleOf({ agent: "pi", name: "pi.harness.run" })).toBe("session");
      expect(genAiOperationRoleOf({ agent: "pi", name: "pi.ai.request" })).toBe("modelCall");
      expect(genAiOperationRoleOf({ agent: "pi", name: "pi.harness.tool" })).toBe("toolRun");
    });

    it("feeds the per-call fact table from the model-call span", () => {
      expect(SPAN_FED_MODEL_CALL_AGENT_IDS.has("pi")).toBe(true);
      expect(isSpanFedModelCall({ agent: "pi", name: "pi.ai.request" })).toBe(true);
      expect(isSpanFedModelCall({ agent: "pi", name: "pi.harness.tool" })).toBe(false);
    });

    it("counts pi.ai.request as a model-call span", () => {
      expect(isModelCallSpan("pi.ai.request")).toBe(true);
    });
  });

  describe("when deriving the session key", () => {
    it("reads pi.session.id", () => {
      expect(
        piAgent.deriveSessionKeyFromSpan?.({
          name: "pi.harness.turn",
          attrs: { "pi.session.id": "s-1" },
        }),
      ).toBe("s-1");
    });

    it("declines a span without one, which is ambient telemetry", () => {
      expect(piAgent.spansRequireSessionKey).toBe(true);
      expect(piAgent.deriveSessionKeyFromSpan?.({ name: "pi.harness.turn", attrs: {} })).toBeNull();
    });
  });

  /**
   * pi 0.84.2 fires `session_before_compact` and `session_compact`, so the
   * compaction span arrives. `sessionSpanNames` is also the admission list.
   */
  it("declares the compaction span, which pi does emit", () => {
    expect(piAgent.sessionSpanNames).toContain("pi.harness.compaction");
  });

  describe("given the canonicalisation allowlist", () => {
    it("holds every pi key the fold reads", () => {
      const missing = PI_FOLD_KEYS.filter((key) => !CODING_AGENT_CONTRIBUTION_KEYS.includes(key));
      expect(missing).toEqual([]);
    });

    /** Marks a span carrying stand-in values, so no reader prices a constant. */
    it("holds the estimated-attribute marker", () => {
      expect(CODING_AGENT_CONTRIBUTION_KEYS).toContain("langwatch.attributes.estimated");
    });
  });
});
