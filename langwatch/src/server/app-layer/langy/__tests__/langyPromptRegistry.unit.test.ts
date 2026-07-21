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
    it("never propagates the error and falls back", async () => {
      const read = vi.fn().mockRejectedValue(new Error("db down"));
      const result = await resolveLangyPrompt({
        promptService: fakePromptService(read),
        projectId: PROJECT_ID,
        handle: LANGY_PROMPT_HANDLES.agentDefinition,
        fallback: FALLBACK,
      });

      expect(result).toEqual({ text: FALLBACK, source: "fallback" });
    });
  });

  describe("the override fallback constant", () => {
    it("is the same terse role framing the turn service composes", () => {
      expect(LANGY_TURN_OVERRIDE_FALLBACK).toContain(
        "you are Langy, the in-product LangWatch assistant.",
      );
      expect(LANGY_TURN_OVERRIDE_FALLBACK).toContain("never offer 'next actions'");
    });
  });
});
