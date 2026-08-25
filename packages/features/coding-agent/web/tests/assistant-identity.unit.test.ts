/**
 * @vitest-environment node
 * @unit
 *
 * The bridge from a stored session's agent slug to the assistant kind whose
 * name and mark a reader recognises.
 */
import { describe, expect, it } from "vitest";

import { assistantKindOfAgent } from "../src/assistant-identity";

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
