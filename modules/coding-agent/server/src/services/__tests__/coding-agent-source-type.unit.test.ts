/**
 * @vitest-environment node
 * @unit
 *
 * The two vocabularies that meet at the bundled-plan policy: a detected agent
 * id on one side, the `assistantKind` an admin's tile carries on the other.
 * Where they disagree the mapper renames; where they agree it must not.
 *
 * Cowork is the case with money on it. It reuses the Claude Code runtime and
 * carries the same brand mark, so folding it into `claude_code` looks like a
 * tidy-up; it would make unticking bundled subscription on the Claude Code
 * tile silently rebill every Cowork session. That fold is what this pins.
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
