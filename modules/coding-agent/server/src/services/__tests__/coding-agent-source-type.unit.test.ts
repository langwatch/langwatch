/**
 * @vitest-environment node
 * @unit
 * Two vocabularies meet at bundled-plan policy: agent id vs tile assistantKind;
 * mapper renames when they disagree; Cowork must not fold into claude_code or
 * unticking bundled subscription would rebill Cowork.
 */
import { describe, expect, it } from "vitest";

import { ingestSourceTypeOfAgent } from "./coding-agent-source-type.unit.test.ts";

describe("ingestSourceTypeOfAgent", () => {
  describe("when the two vocabularies disagree", () => {
    it("renames the registry id to the slug a tile is keyed on", () => {
      expect(ingestSourceTypeOfAgent("gemini_cli")).toBe("gemini");
      expect(ingestSourceTypeOfAgent("copilot")).toBe("github_copilot");
    });
  });

  describe("when the two vocabularies agree", () => {
    it("passes the agent through unchanged", () => {
      expect(ingestSourceTypeOfAgent("claude_code")).toBe("claude_code");
      expect(ingestSourceTypeOfAgent("codex")).toBe("codex");
      expect(ingestSourceTypeOfAgent("opencode")).toBe("opencode");
    });
  });

  describe("when the agent is Cowork", () => {
    it("keeps it its own source type rather than folding it into Claude Code", () => {
      expect(ingestSourceTypeOfAgent("claude_cowork")).toBe("claude_cowork");
    });
  });

  describe("when this build's registry does not know the agent", () => {
    it("passes it through rather than guessing a slug", () => {
      expect(ingestSourceTypeOfAgent("some_future_agent")).toBe(
        "some_future_agent",
      );
    });
  });
});
