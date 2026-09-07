import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  MISSING_PLACEHOLDER_PUSHBACK,
  MISSING_REVEAL_ID_PUSHBACK,
  SECRET_SNIPPET_SHOWN,
  SECRET_SNIPPET_TOOL_NAME,
  answerSecretSnippet,
  createSecretSnippetExtension,
} from "./secret-snippet.js";

type RegisteredTool = {
  name: string;
  label: string;
  description: string;
  parameters: { properties: Record<string, unknown>; required?: string[] };
  execute: (
    toolCallId: string,
    params: unknown,
  ) => Promise<{ content: { type: string; text: string }[] }>;
};

function secretSnippetTool(): RegisteredTool {
  let registered: RegisteredTool | undefined;
  const pi = {
    registerTool: (tool: RegisteredTool) => {
      registered = tool;
    },
    on: () => undefined,
  };
  const extension = createSecretSnippetExtension() as {
    factory: (pi: ExtensionAPI) => void;
  };
  extension.factory(pi as unknown as ExtensionAPI);
  return registered!;
}

const TEMPLATE = 'export OPENAI_BASE_URL="https://gateway.example/v1"\nexport OPENAI_API_KEY="{{secret}}"';

describe("secret_snippet", () => {
  describe("given the registered tool", () => {
    it("registers under its name with the three arguments", () => {
      const tool = secretSnippetTool();
      expect(tool.name).toBe(SECRET_SNIPPET_TOOL_NAME);
      expect(Object.keys(tool.parameters.properties)).toEqual([
        "revealId",
        "template",
        "preview",
      ]);
      expect(tool.parameters.required).toEqual(["revealId", "template"]);
      expect(tool.description).toContain("never print a value that starts with vk-lw-");
    });
  });

  describe("when Langy calls it with a reveal id and a template", () => {
    /** @scenario "The worker tool answers the model without the secret" */
    it("answers that the card is shown, and nothing that could be the key", async () => {
      const tool = secretSnippetTool();
      const result = await tool.execute("call_1", {
        revealId: "rvl_abc",
        template: TEMPLATE,
        preview: "vk-lw-01HZX9N",
      });
      const text = result.content.map((part) => part.text).join("");
      expect(text).toBe(SECRET_SNIPPET_SHOWN);
      expect(text).not.toMatch(/vk-lw-[0-9A-Z]{26}/);
    });
  });

  describe("when the template has no placeholder", () => {
    it("refuses with the placeholder named", () => {
      expect(
        answerSecretSnippet({
          revealId: "rvl_abc",
          template: 'export OPENAI_API_KEY="<the key>"',
        }),
      ).toBe(MISSING_PLACEHOLDER_PUSHBACK);
    });
  });

  describe("when the reveal id is missing", () => {
    it("refuses and says where the id comes from", () => {
      expect(answerSecretSnippet({ template: TEMPLATE })).toBe(
        MISSING_REVEAL_ID_PUSHBACK,
      );
      expect(answerSecretSnippet({ revealId: "  ", template: TEMPLATE })).toBe(
        MISSING_REVEAL_ID_PUSHBACK,
      );
      expect(MISSING_REVEAL_ID_PUSHBACK).toContain("reveal_id");
    });
  });
});
