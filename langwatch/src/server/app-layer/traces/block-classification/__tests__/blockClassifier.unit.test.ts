import { describe, expect, it } from "vitest";
import { classifyBlocks } from "../blockClassifier.service";
import {
  InputCategory,
  MAX_CLASSIFIED_BLOCKS_PER_SPAN,
  OutputCategory,
} from "../categories";

const categoriesOf = (blocks: { category: string }[]): string[] =>
  blocks.map((b) => b.category);

describe("classifyBlocks", () => {
  describe("given a span with a system prompt, a user message, and a tool result", () => {
    /** @scenario "Content blocks of a coding-agent span are classified into cost categories" */
    it("lists each block with its category", () => {
      const { input } = classifyBlocks({
        inputMessages: [
          { role: "system", content: "You are a coding assistant." },
          {
            role: "assistant",
            content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }],
          },
          {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "t1", content: "file body" },
              { type: "text", text: "now fix the bug" },
            ],
          },
        ],
      });

      expect(categoriesOf(input)).toEqual([
        InputCategory.SYSTEM_PROMPT,
        InputCategory.PRIOR_CONTEXT,
        InputCategory.TOOL_RESULT_BUILTIN,
        InputCategory.USER_INPUT,
      ]);
      expect(input.map((b) => b.idx)).toEqual([0, 1, 2, 3]);
    });
  });

  describe("given an MCP tool call and a built-in tool call", () => {
    /** @scenario "MCP tool activity is distinguished from built-in tool activity" */
    it("distinguishes MCP tool activity from built-in tool activity", () => {
      const { output } = classifyBlocks({
        inputMessages: [],
        outputMessages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "a",
                name: "mcp__github__create_issue",
                input: {},
              },
              { type: "tool_use", id: "b", name: "Bash", input: {} },
            ],
          },
        ],
      });

      expect(categoriesOf(output)).toEqual([
        OutputCategory.TOOL_CALL_MCP,
        OutputCategory.TOOL_CALL_BUILTIN,
      ]);
    });

    it("distinguishes MCP tool results from built-in tool results", () => {
      const { input } = classifyBlocks({
        inputMessages: [
          {
            role: "assistant",
            content: [
              { type: "tool_use", id: "a", name: "mcp__db__query", input: {} },
              { type: "tool_use", id: "b", name: "Grep", input: {} },
            ],
          },
          {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "a", content: "rows" },
              { type: "tool_result", tool_use_id: "b", content: "matches" },
            ],
          },
        ],
      });

      expect(input.map((b) => b.category)).toContain(
        InputCategory.TOOL_RESULT_MCP,
      );
      expect(input.map((b) => b.category)).toContain(
        InputCategory.TOOL_RESULT_BUILTIN,
      );
    });

    it("falls back to built-in when the tool name is unresolvable", () => {
      const { input } = classifyBlocks({
        inputMessages: [
          {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "orphan", content: "x" },
            ],
          },
        ],
      });
      expect(categoriesOf(input)).toEqual([InputCategory.TOOL_RESULT_BUILTIN]);
    });
  });

  describe("given a user message that opens with injected context", () => {
    /** @scenario "Injected context markers are classified separately from real user input" */
    it("classifies the injected context separately from the user's request", () => {
      const { input } = classifyBlocks({
        inputMessages: [
          {
            role: "user",
            content:
              "<system-reminder>stay on task</system-reminder>\nAdd a test",
          },
        ],
      });

      expect(categoriesOf(input)).toEqual([
        InputCategory.PRIOR_CONTEXT,
        InputCategory.USER_INPUT,
      ]);
      // The reminder text is not counted as user input.
      const userInput = input.find(
        (b) => b.category === InputCategory.USER_INPUT,
      );
      expect(userInput?.charCount).toBe("Add a test".length);
    });
  });

  describe("given a tool_use nested in the fresh user message", () => {
    it("keeps it on the input axis instead of leaking an output tool_call category", () => {
      const { input } = classifyBlocks({
        inputMessages: [
          {
            role: "user",
            content: [
              { type: "tool_use", id: "x", name: "mcp__db__query", input: {} },
              { type: "text", text: "and answer this" },
            ],
          },
        ],
      });
      expect(categoriesOf(input)).toEqual([
        InputCategory.OTHER_INPUT,
        InputCategory.USER_INPUT,
      ]);
      // No output-axis category leaked onto the input axis.
      expect(categoriesOf(input)).not.toContain(OutputCategory.TOOL_CALL_MCP);
    });
  });

  describe("given a prior assistant turn and a fresh user turn", () => {
    it("classifies earlier turns as prior context and only the last user body as user input", () => {
      const { input } = classifyBlocks({
        inputMessages: [
          { role: "user", content: "first question" },
          { role: "assistant", content: "earlier reply" },
          { role: "user", content: "the current request" },
        ],
      });
      expect(categoriesOf(input)).toEqual([
        InputCategory.PRIOR_CONTEXT,
        InputCategory.PRIOR_CONTEXT,
        InputCategory.USER_INPUT,
      ]);
    });
  });

  describe("given assistant thinking and image blocks", () => {
    it("classifies thinking on the output axis", () => {
      const { output } = classifyBlocks({
        inputMessages: [],
        outputMessages: [
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "let me reason" },
              { type: "text", text: "here is the answer" },
            ],
          },
        ],
      });
      expect(categoriesOf(output)).toEqual([
        OutputCategory.THINKING,
        OutputCategory.ASSISTANT_TEXT,
      ]);
    });

    it("classifies an image in the fresh user turn as image", () => {
      const { input } = classifyBlocks({
        inputMessages: [
          {
            role: "user",
            content: [
              { type: "image", source: {} },
              { type: "text", text: "what is this" },
            ],
          },
        ],
      });
      expect(categoriesOf(input)).toEqual([
        InputCategory.IMAGE,
        InputCategory.USER_INPUT,
      ]);
    });
  });

  describe("given request tool definitions", () => {
    it("classifies definitions into tool_definitions and mcp_tool_definitions by name prefix", () => {
      const { input } = classifyBlocks({
        inputMessages: [{ role: "system", content: "sys" }],
        tools: [
          { name: "Bash", description: "run a command" },
          { name: "mcp__linear__list_issues", description: "list" },
        ],
      });
      expect(categoriesOf(input)).toEqual([
        InputCategory.SYSTEM_PROMPT,
        InputCategory.TOOL_DEFINITIONS,
        InputCategory.MCP_TOOL_DEFINITIONS,
      ]);
    });
  });

  describe("given more blocks than the per-span cap", () => {
    it("bounds the detail array and folds overflow into the catch-all", () => {
      const content = Array.from({ length: 600 }, (_, i) => ({
        type: "text",
        text: `block ${i}`,
      }));
      const { output } = classifyBlocks({
        inputMessages: [],
        outputMessages: [{ role: "assistant", content }],
      });

      expect(output).toHaveLength(MAX_CLASSIFIED_BLOCKS_PER_SPAN);
      expect(output[output.length - 1]?.category).toBe(
        OutputCategory.OTHER_OUTPUT,
      );
      const totalChars = content.reduce((n, b) => n + b.text.length, 0);
      const classifiedChars = output.reduce((n, b) => n + b.charCount, 0);
      expect(classifiedChars).toBe(totalChars);
    });
  });

  describe("given malformed content", () => {
    it("does not throw and returns empty axes", () => {
      expect(() =>
        classifyBlocks({ inputMessages: "not an array" }),
      ).not.toThrow();
      expect(classifyBlocks({ inputMessages: 42 })).toEqual({
        input: [],
        output: [],
      });
    });

    it("skips non-object content parts without failing", () => {
      const { input } = classifyBlocks({
        inputMessages: [
          { role: "user", content: [null, 7, { type: "text", text: "hi" }] },
        ],
      });
      expect(categoriesOf(input)).toEqual([InputCategory.USER_INPUT]);
    });
  });

  describe("when the same content is classified twice", () => {
    /** @scenario "Classification is deterministic for replay" */
    it("produces identical output (deterministic for replay)", () => {
      const messages = [
        { role: "system", content: "sys" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "t1", name: "mcp__x__y", input: { a: 1 } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "t1", content: "ok" },
            { type: "text", text: "continue" },
          ],
        },
      ];
      const first = classifyBlocks({ inputMessages: messages });
      const second = classifyBlocks({ inputMessages: messages });
      expect(first).toEqual(second);
    });
  });
});
