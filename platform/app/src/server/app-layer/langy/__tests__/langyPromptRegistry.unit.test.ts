import { describe, expect, it, vi } from "vitest";
import type { PromptService } from "~/server/prompt-config/prompt.service";
import {
  LANGY_PROMPT_DEFAULT_TAG,
  LANGY_PROMPT_HANDLES,
  LANGY_TURN_OVERRIDE_FALLBACK,
  resolveLangyPrompt,
} from "../langyPromptRegistry";

const FALLBACK = "IN-REPO FALLBACK PROMPT";
const PROJECT_ID = "project_system";

/** Build a fake PromptService whose read returns whatever `prompt` is passed. */
function fakePromptService(
  getPromptByIdOrHandle: PromptService["getPromptByIdOrHandle"],
): Pick<PromptService, "getPromptByIdOrHandle"> {
  return { getPromptByIdOrHandle };
}

describe("resolveLangyPrompt", () => {
  describe("given a registry row with a non-empty prompt", () => {
    it("returns the registry text and marks the source registry", async () => {
      const read = vi.fn().mockResolvedValue({ prompt: "REGISTRY VERSION" });
      const result = await resolveLangyPrompt({
        promptService: fakePromptService(read),
        projectId: PROJECT_ID,
        handle: LANGY_PROMPT_HANDLES.turnOverride,
        fallback: FALLBACK,
      });

      expect(result).toEqual({ text: "REGISTRY VERSION", source: "registry" });
    });

    it("pins the production tag by default", async () => {
      const read = vi.fn().mockResolvedValue({ prompt: "REGISTRY VERSION" });
      await resolveLangyPrompt({
        promptService: fakePromptService(read),
        projectId: PROJECT_ID,
        handle: LANGY_PROMPT_HANDLES.agentDefinition,
        fallback: FALLBACK,
      });

      expect(read).toHaveBeenCalledWith({
        idOrHandle: LANGY_PROMPT_HANDLES.agentDefinition,
        projectId: PROJECT_ID,
        tag: LANGY_PROMPT_DEFAULT_TAG,
      });
    });

    it("forwards an explicit tag when asked to read latest", async () => {
      const read = vi.fn().mockResolvedValue({ prompt: "DRAFT" });
      await resolveLangyPrompt({
        promptService: fakePromptService(read),
        projectId: PROJECT_ID,
        handle: LANGY_PROMPT_HANDLES.turnOverride,
        fallback: FALLBACK,
        tag: "latest",
      });

      expect(read).toHaveBeenCalledWith(
        expect.objectContaining({ tag: "latest" }),
      );
    });
  });

  describe("given no matching registry row", () => {
    it("falls back to the in-repo copy", async () => {
      const read = vi.fn().mockResolvedValue(null);
      const result = await resolveLangyPrompt({
        promptService: fakePromptService(read),
        projectId: PROJECT_ID,
        handle: LANGY_PROMPT_HANDLES.turnOverride,
        fallback: FALLBACK,
      });

      expect(result).toEqual({ text: FALLBACK, source: "fallback" });
    });
  });

  describe("given a registry row whose prompt is blank", () => {
    /** @scenario "An empty or blank registry prompt is treated as a miss" */
    it("treats whitespace-only as a miss and falls back", async () => {
      const read = vi.fn().mockResolvedValue({ prompt: "   \n  " });
      const result = await resolveLangyPrompt({
        promptService: fakePromptService(read),
        projectId: PROJECT_ID,
        handle: LANGY_PROMPT_HANDLES.turnOverride,
        fallback: FALLBACK,
      });

      expect(result).toEqual({ text: FALLBACK, source: "fallback" });
    });
  });

  describe("given the registry read throws", () => {
    it("never propagates the error and falls back, reporting source 'error'", async () => {
      const read = vi.fn().mockRejectedValue(new Error("db down"));
      const result = await resolveLangyPrompt({
        promptService: fakePromptService(read),
        projectId: PROJECT_ID,
        handle: LANGY_PROMPT_HANDLES.agentDefinition,
        fallback: FALLBACK,
      });

      // The TEXT is the fallback either way — the invariant is that a read
      // failure never blocks a turn. The SOURCE is what tells a failure apart
      // from a genuine miss, so a caller composing a per-conversation prefix can
      // hold its last good text through a blip instead of swapping the model's
      // instructions mid-conversation.
      expect(result).toEqual({ text: FALLBACK, source: "error" });
    });
  });

  describe("the override fallback constant", () => {
    it("carries the persona and defers to the operating contract", () => {
      expect(LANGY_TURN_OVERRIDE_FALLBACK).toContain("Langy");
      expect(LANGY_TURN_OVERRIDE_FALLBACK).toContain("AGENTS.md");
    });

    // The one rule this block spends its last-position budget on, because it
    // is the measured defect: 40% of turns reaching `status: "completed"` in
    // production make zero tool calls. Without this assertion the size check
    // below passes just as happily on a block that dropped it.
    it("keeps the grounding rule", () => {
      expect(LANGY_TURN_OVERRIDE_FALLBACK).toContain("retrieve this turn");
    });

    // The other measured defect: replies closing with a next-actions question.
    // The ban lives in AGENTS.md; this last-position pointer is what makes the
    // model obey it, so dropping it regresses reply endings silently.
    it("keeps the ending rule", () => {
      expect(LANGY_TURN_OVERRIDE_FALLBACK).toContain("End on the answer");
    });

    // The worker already reads the persona in the agent's config prompt and
    // the operating rules in AGENTS.md. This block is the operator hot-patch
    // channel; when it also repeated the rules, the model read the same
    // commandments three times and drift between the copies became
    // contradictions. Keep it sentence-scale.
    it("stays a pointer, not a third copy of the rules", () => {
      expect(LANGY_TURN_OVERRIDE_FALLBACK.length).toBeLessThan(300);
    });
  });
});
