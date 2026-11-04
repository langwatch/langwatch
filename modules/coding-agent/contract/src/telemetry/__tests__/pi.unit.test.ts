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
 * The keys the pi fold reads off a span's lifted facts. The allowlist drops
 * anything unlisted silently, so this test is the only symptom of a removal.
 * Everything else pi sends arrives through the `gen_ai.*` mirrors.
 */
const PI_FOLD_KEYS = ["pi.ai.usage.cost"];

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
   * pi 0.84.2 fires `session_compact` and `session_tree`, so compaction, its
   * reason-carrying step and navigation arrive. `sessionSpanNames` is also the
   * admission list.
   */
  /** @scenario "The compaction, step and navigation spans the extension emits join the pi session" */
  it("admits the harness spans the extension emits", () => {
    expect(piAgent.sessionSpanNames).toEqual(
      expect.arrayContaining(["pi.harness.compaction", "pi.harness.step", "pi.harness.navigation"]),
    );
  });

  /** @scenario "A harness span pi declares but we do not list is dropped with nothing recorded" */
  it("does not admit the checkpoint span, which no pi event drives", () => {
    expect(piAgent.sessionSpanNames).not.toContain("pi.harness.checkpoint");
  });

  describe("given the canonicalisation allowlist", () => {
    it("holds every pi key the fold reads", () => {
      const missing = PI_FOLD_KEYS.filter((key) => !CODING_AGENT_CONTRIBUTION_KEYS.includes(key));
      expect(missing).toEqual([]);
    });

    it("holds no pi key the fold does not read", () => {
      expect(CODING_AGENT_CONTRIBUTION_KEYS.filter((key) => key.startsWith("pi."))).toEqual(
        PI_FOLD_KEYS,
      );
    });

    /** The pi canonicaliser takes these off the span before the allowlist runs. */
    it("leaves out the token counts the canonicaliser consumes", () => {
      const consumed = [
        "pi.ai.usage.cache_read_tokens",
        "pi.ai.usage.cache_write_tokens",
        "pi.ai.usage.reasoning_tokens",
      ];
      expect(consumed.filter((key) => CODING_AGENT_CONTRIBUTION_KEYS.includes(key))).toEqual([]);
    });
  });
});
