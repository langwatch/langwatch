/**
 * A coding-agent interaction summarised at write time.
 *
 * `ComputedInput`/`ComputedOutput` model a conversation — one thing asked, one
 * thing answered. For a coding agent the input genuinely is the prompt, but the
 * "output" is only the closing remark: the interaction itself was reading twelve
 * files, running the tests, editing three of them, spawning a sub-agent. None of
 * that survives into one output string. These attributes carry the WORK.
 */
import { describe, expect, it } from "vitest";
import type { NormalizedSpan } from "../../../schemas/spans";
import {
  accumulateInteractionSummary,
  INTERACTION_ATTRS,
} from "../interaction-summary.service";

function span(over: Partial<NormalizedSpan>): NormalizedSpan {
  return {
    name: "claude_code.tool",
    spanAttributes: {},
    statusCode: null,
    parentSpanId: null,
    ...over,
  } as unknown as NormalizedSpan;
}

/** Fold a sequence of spans the way the projection does. */
function foldAll(spans: NormalizedSpan[]): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const s of spans) {
    Object.assign(attributes, accumulateInteractionSummary({ attributes, span: s }));
  }
  return attributes;
}

describe("accumulateInteractionSummary", () => {
  describe("given an interaction that read, edited and ran commands", () => {
    const attributes = foldAll([
      span({ name: "claude_code.llm_request" }),
      span({ name: "claude_code.llm_request" }),
      span({
        spanAttributes: { tool_name: "Read", file_path: "a.ts" },
      }),
      span({
        spanAttributes: { tool_name: "Read", file_path: "b.ts" },
      }),
      span({ spanAttributes: { tool_name: "Bash" } }),
      span({
        spanAttributes: { tool_name: "Edit", file_path: "a.ts" },
      }),
      span({ name: "claude_code.subagent.spawn" }),
    ]);

    it("counts the model calls in the loop", () => {
      expect(attributes[INTERACTION_ATTRS.MODEL_CALLS]).toBe("2");
    });

    it("counts the tool runs and which tools they were", () => {
      expect(attributes[INTERACTION_ATTRS.TOOL_CALLS]).toBe("4");
      expect(JSON.parse(attributes[INTERACTION_ATTRS.TOOLS] ?? "{}")).toEqual({
        Read: 2,
        Bash: 1,
        Edit: 1,
      });
    });

    it("records the distinct files it touched, without duplicates", () => {
      expect(
        JSON.parse(attributes[INTERACTION_ATTRS.FILES_TOUCHED] ?? "[]"),
      ).toEqual(["a.ts", "b.ts"]);
    });

    it("counts the sub-agents it spawned", () => {
      expect(attributes[INTERACTION_ATTRS.SUB_AGENTS]).toBe("1");
    });
  });

  describe("given a tool that failed", () => {
    it("counts it, so a broken interaction is visible without opening it", () => {
      const attributes = foldAll([
        span({ spanAttributes: { tool_name: "Bash" }, statusCode: "error" }),
        span({ spanAttributes: { tool_name: "Bash" } }),
      ]);

      expect(attributes[INTERACTION_ATTRS.FAILED_TOOLS]).toBe("1");
      expect(attributes[INTERACTION_ATTRS.TOOL_CALLS]).toBe("2");
    });
  });

  describe("given an ordinary LLM span", () => {
    it("derives nothing, so a normal chat trace pays a name comparison", () => {
      expect(
        accumulateInteractionSummary({
          attributes: {},
          span: span({ name: "openai.chat", spanAttributes: { foo: "bar" } }),
        }),
      ).toEqual({});
    });
  });
});
