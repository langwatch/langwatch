/**
 * Unit tests for the propose_suggestion tool (PR-5.1).
 *
 * Binds the producer scenarios in specs/assistant/langy-proactive.feature:
 *   - "Langy emits at most one suggestion per turn"
 *   - "Dismissed kinds do not reappear" (server-side enforcement on top of
 *      the frontend filter from PR-5.2)
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { ConversationToolIdSet } from "../../toolIdValidator";
import { isLangySuggestion } from "../../suggestion";
import { makeProposeSuggestion } from "../suggestions";
import type { LangyConversationContext } from "../types";

function makeCtx(opts: {
  dismissedSuggestionKinds?: string[];
  suggestionEmissionTracker?: { count: number };
} = {}): LangyConversationContext {
  return {
    projectId: "project-1",
    seenIds: new ConversationToolIdSet(),
    batchEvaluationService:
      {} as LangyConversationContext["batchEvaluationService"],
    datasetService: {} as LangyConversationContext["datasetService"],
    evaluatorService: {} as LangyConversationContext["evaluatorService"],
    experimentService: {} as LangyConversationContext["experimentService"],
    projectService: {} as LangyConversationContext["projectService"],
    promptService: {} as LangyConversationContext["promptService"],
    suggestionsEnabled: true,
    suggestionEmissionTracker: opts.suggestionEmissionTracker,
    dismissedSuggestionKinds: opts.dismissedSuggestionKinds,
  };
}

function invokeTool(toolDef: unknown, input: unknown): Promise<unknown> {
  const exec = (toolDef as { execute: (i: unknown) => Promise<unknown> })
    .execute;
  return exec(input);
}

const sampleInput = {
  kind: "rerun-stale-experiment",
  label: "Rerun the stale experiment",
  rationale: "It hasn't run in 3 weeks.",
  action: { type: "ask_followup" as const, prompt: "Rerun the experiment" },
};

describe("propose_suggestion tool", () => {
  describe("given a fresh per-turn tracker and no dismissed kinds", () => {
    describe("when the agent calls propose_suggestion once", () => {
      it("returns a valid LangySuggestion with the marker stamped on", async () => {
        const tracker = { count: 0 };
        const tool = makeProposeSuggestion(
          makeCtx({ suggestionEmissionTracker: tracker }),
        );
        const result = await invokeTool(tool, sampleInput);
        expect(isLangySuggestion(result)).toBe(true);
        expect((result as { kind: string }).kind).toBe(
          "rerun-stale-experiment",
        );
      });

      it("increments the per-turn counter to enforce the one-per-turn rule", async () => {
        const tracker = { count: 0 };
        const tool = makeProposeSuggestion(
          makeCtx({ suggestionEmissionTracker: tracker }),
        );
        await invokeTool(tool, sampleInput);
        expect(tracker.count).toBe(1);
      });
    });
  });

  describe("given the tracker already shows one emission this turn", () => {
    describe("when the agent tries to propose a second suggestion", () => {
      it("returns a structured suggestion_limit_exceeded error, not a suggestion", async () => {
        const tracker = { count: 1 };
        const tool = makeProposeSuggestion(
          makeCtx({ suggestionEmissionTracker: tracker }),
        );
        const result = (await invokeTool(tool, sampleInput)) as {
          error?: { code: string; kind: string };
        };
        expect(result.error?.code).toBe("suggestion_limit_exceeded");
        expect(result.error?.kind).toBe("rerun-stale-experiment");
      });

      it("does NOT bump the counter past 1", async () => {
        const tracker = { count: 1 };
        const tool = makeProposeSuggestion(
          makeCtx({ suggestionEmissionTracker: tracker }),
        );
        await invokeTool(tool, sampleInput);
        expect(tracker.count).toBe(1);
      });
    });
  });

  describe("given the kind is in the user's dismissedSuggestionKinds list", () => {
    describe("when the agent tries to propose that kind anyway", () => {
      it("returns a structured suggestion_kind_dismissed error", async () => {
        const tracker = { count: 0 };
        const tool = makeProposeSuggestion(
          makeCtx({
            suggestionEmissionTracker: tracker,
            dismissedSuggestionKinds: ["rerun-stale-experiment"],
          }),
        );
        const result = (await invokeTool(tool, sampleInput)) as {
          error?: { code: string; kind: string };
        };
        expect(result.error?.code).toBe("suggestion_kind_dismissed");
      });

      it("does NOT consume the per-turn budget — agent can still try a different kind", async () => {
        const tracker = { count: 0 };
        const tool = makeProposeSuggestion(
          makeCtx({
            suggestionEmissionTracker: tracker,
            dismissedSuggestionKinds: ["rerun-stale-experiment"],
          }),
        );
        await invokeTool(tool, sampleInput);
        expect(tracker.count).toBe(0);
      });
    });
  });

  describe("given action variants", () => {
    describe("when the action is open_proposal", () => {
      it("passes the proposalId through to the chip payload", async () => {
        const tool = makeProposeSuggestion(
          makeCtx({ suggestionEmissionTracker: { count: 0 } }),
        );
        const result = (await invokeTool(tool, {
          ...sampleInput,
          action: { type: "open_proposal", proposalId: "prop_abc" },
        })) as { action: { type: string; proposalId?: string } };
        expect(result.action.type).toBe("open_proposal");
        expect(result.action.proposalId).toBe("prop_abc");
      });
    });

    describe("when the action is open_url", () => {
      it("passes the href through", async () => {
        const tool = makeProposeSuggestion(
          makeCtx({ suggestionEmissionTracker: { count: 0 } }),
        );
        const result = (await invokeTool(tool, {
          ...sampleInput,
          action: { type: "open_url", href: "/experiments/demo" },
        })) as { action: { type: string; href?: string } };
        expect(result.action.type).toBe("open_url");
        expect(result.action.href).toBe("/experiments/demo");
      });
    });
  });
});

describe("buildLangyTools — suggestion gating (PR-5.1 Mastra-only)", () => {
  describe("given suggestionsEnabled is false (legacy path)", () => {
    it("does not register propose_suggestion", async () => {
      const { buildLangyTools } = await import("../index");
      const ctx = makeCtx();
      ctx.suggestionsEnabled = false;
      const tools = buildLangyTools(ctx);
      expect((tools as Record<string, unknown>).propose_suggestion).toBeUndefined();
    });
  });

  describe("given suggestionsEnabled is true (Mastra path)", () => {
    it("registers propose_suggestion alongside the other tools", async () => {
      const { buildLangyTools } = await import("../index");
      const ctx = makeCtx({ suggestionEmissionTracker: { count: 0 } });
      const tools = buildLangyTools(ctx);
      expect((tools as Record<string, unknown>).propose_suggestion).toBeDefined();
    });
  });
});
