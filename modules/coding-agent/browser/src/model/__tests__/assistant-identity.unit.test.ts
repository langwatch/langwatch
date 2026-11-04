/**
 * @vitest-environment node
 * @unit
 * The bridge from a stored session's agent slug to the assistant kind whose
 * name and mark a reader recognises.
 */
import { describe, expect, it } from "vitest";

import { assistantKindOfAgent } from "../assistant-identity.ts";
import { ASSISTANT_PRESETS } from "../assistant-presets.ts";

describe("assistantKindOfAgent", () => {
  describe("given a slug the tiles already use", () => {
    /** @scenario "An agent slug resolves to its product name" */
    it("resolves claude_code to its own kind", () => {
      expect(assistantKindOfAgent("claude_code")).toBe("claude_code");
    });

    /** @scenario "An agent slug resolves to its product name" */
    /** @scenario "An agent slug resolves to its product name" */
    it("resolves opencode to its own kind", () => {
      expect(assistantKindOfAgent("opencode")).toBe("opencode");
    });

    /** @scenario "An agent slug resolves to its product name" */
    it("resolves pi to its own kind, wearing pi's own mark", () => {
      expect(assistantKindOfAgent("pi")).toBe("pi");
      expect(ASSISTANT_PRESETS.pi.iconUrl).toBe("/images/external-icons/pi.svg");
      expect(ASSISTANT_PRESETS.pi.darkModeInvert).toBe(false);
    });
  });

  describe("given a slug the registry spells differently", () => {
    /** @scenario "An agent slug resolves to its product name" */
    it("folds gemini_cli into gemini", () => {
      expect(assistantKindOfAgent("gemini_cli")).toBe("gemini");
    });

    /** @scenario "An agent slug resolves to its product name" */
    it("folds copilot into github_copilot", () => {
      expect(assistantKindOfAgent("copilot")).toBe("github_copilot");
    });

    /** @scenario The session list names the agent Grok */
    it("names grok as Grok, with its own preset", () => {
      expect(assistantKindOfAgent("grok")).toBe("grok");
      expect(ASSISTANT_PRESETS.grok.label).toBe("Grok");
    });
  });

  describe("given a slug carrying whitespace", () => {
    /** @scenario "An agent slug resolves to its product name" */
    it("resolves it anyway", () => {
      expect(assistantKindOfAgent(" claude_code ")).toBe("claude_code");
    });
  });

  describe("given an agent this build does not know", () => {
    /** @scenario "An agent slug resolves to its product name" */
    it("resolves nothing for an unknown slug", () => {
      expect(assistantKindOfAgent("some_other_agent")).toBeNull();
    });

    /** @scenario "An agent slug resolves to its product name" */
    it("resolves nothing for an empty slug", () => {
      expect(assistantKindOfAgent("")).toBeNull();
    });
  });
});
