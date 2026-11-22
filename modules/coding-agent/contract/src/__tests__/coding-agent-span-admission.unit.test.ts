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

  describe("given the spans captured from the Copilot CLI 1.0.100 and VS Code Copilot Chat 0.67", () => {
    /** @scenario Copilot's model call, session root and tool run spans are admitted */
    it.each([
      { scopeName: "github.copilot", name: "chat gpt-6-luna" },
      { scopeName: "github.copilot", name: "invoke_agent" },
      { scopeName: "github.copilot", name: "execute_tool rg" },
      { scopeName: "copilot-chat", name: "chat gpt-6-luna" },
      { scopeName: "copilot-chat", name: "invoke_agent GitHub Copilot Chat" },
      { scopeName: "copilot-chat", name: "execute_tool manage_todo_list" },
    ])("admits $name from the $scopeName scope", (candidate) => {
      expect(admitsCodingAgentSpan(candidate)).toBe(true);
    });

    /** @scenario A Copilot span of an undeclared operation is not admitted */
    it("does not admit VS Code's execute_hook span", () => {
      expect(
        admitsCodingAgentSpan({ name: "execute_hook SessionStart", scopeName: "copilot-chat" }),
      ).toBe(false);
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
