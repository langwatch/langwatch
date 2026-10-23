import { describe, expect, it } from "vitest";

import { admitsCodingAgentSpan } from "../index.ts";

describe("admitsCodingAgentSpan", () => {
  describe("given a model call span from another coding agent", () => {
    /** @scenario A chat span from another coding agent is not admitted as a Copilot session span */
    it("does not admit the Gemini CLI's chat span", () => {
      expect(admitsCodingAgentSpan({ name: "chat", scopeName: "gemini-cli" })).toBe(false);
    });

    /** @scenario A chat span from another coding agent is not admitted as a Copilot session span */
    it("does not admit opencode's chat span", () => {
      expect(admitsCodingAgentSpan({ name: "chat gpt-6-luna", scopeName: "opencode" })).toBe(false);
    });
  });

  describe("given the spans of a Copilot Studio audit feed", () => {
    /** @scenario Copilot Studio spans never join a coding-agent session */
    it.each(["copilot_studio.conversation", "copilot_studio.turn", "copilot_studio.tool_call"])(
      "does not admit %s",
      (name) => {
        expect(
          admitsCodingAgentSpan({
            name,
            scopeName: "langwatch.ingestion.copilot_studio_dataverse",
          }),
        ).toBe(false);
      },
    );
  });
});
