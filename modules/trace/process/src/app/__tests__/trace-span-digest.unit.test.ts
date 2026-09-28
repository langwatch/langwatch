import { createApiFixture } from "@langwatch/api-fixture";
import type { Span, TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { TraceApp, type TraceAppDependencies } from "../trace.app.ts";
import type { TraceLegacyRead } from "../trace.members.ts";

function createTraceApp(): TraceApi {
  return TraceApp.create(
    createApiFixture<TraceAppDependencies>({
      traces: createApiFixture<TraceAppDependencies["traces"]>({
        read: createApiFixture<TraceLegacyRead>(),
      }),
    }),
  );
}

describe("TraceApi.formatSpansDigest", () => {
  /** @scenario "Evaluation digests retain captured span content and timing" */
  it("renders the captured input and output with the span duration", async () => {
    const span: Span = {
      span_id: "span-1",
      trace_id: "trace-1",
      type: "span",
      name: "answer-question",
      timestamps: { started_at: 1000, finished_at: 1250 },
      input: { type: "text", value: "What is the capital of France?" },
      output: { type: "text", value: "Paris" },
    };
    const original = structuredClone(span);

    const digest = await createTraceApp().formatSpansDigest({ spans: [span] });

    expect(digest).toContain("Spans: 1");
    expect(digest).toContain("250ms");
    expect(digest).toContain("answer-question");
    expect(digest).toContain("What is the capital of France?");
    expect(digest).toContain("Paris");
    expect(span).toEqual(original);
  });

  /** @scenario "An empty evaluation trace has the canonical empty digest" */
  it("renders an empty trace without fabricating a span", async () => {
    await expect(createTraceApp().formatSpansDigest({ spans: [] })).resolves.toBe(
      "No spans recorded.",
    );
  });
});

describe("TraceApi.formatSpansDigest on a coding agent turn", () => {
  const T0 = Date.UTC(2026, 8, 20, 10, 0, 0);
  const common = {
    project: { repo: "acme/shop" },
    terminal: { type: "tmux" },
    gen_ai: { conversation: { id: "sess-1" } },
  };
  const toolIo = {
    input: { type: "json" as const, value: { command: "pnpm test src/cart.test.ts" } },
    output: { type: "json" as const, value: { status: "completed", success: true } },
  };
  const toolParams = { ...common, tool_name: "Bash", full_command: "pnpm test src/cart.test.ts" };
  const at = (offset: number) => ({ started_at: T0 + offset, finished_at: T0 + offset + 1000 });
  const spans: Span[] = [
    {
      span_id: "root",
      trace_id: "t1",
      type: "span",
      name: "claude_code.interaction",
      timestamps: at(0),
      input: { type: "text", value: "Run the cart tests." },
      params: common,
    },
    {
      span_id: "llm",
      parent_id: "root",
      trace_id: "t1",
      type: "llm",
      name: "claude_code.llm_request",
      model: "claude-opus-5",
      timestamps: at(10),
      output: { type: "text", value: "Running the tests." },
      metrics: { prompt_tokens: 2, completion_tokens: 150 },
      params: {
        ...common,
        gen_ai: { ...common.gen_ai, usage: { input_tokens: 2, output_tokens: 150 } },
        model: "claude-opus-5",
        input_tokens: 2,
        output_tokens: 150,
      },
    },
    {
      span_id: "tool",
      parent_id: "root",
      trace_id: "t1",
      type: "tool",
      name: "claude_code.tool",
      timestamps: at(20),
      params: toolParams,
      ...toolIo,
    },
    {
      span_id: "exec",
      parent_id: "tool",
      trace_id: "t1",
      type: "span",
      name: "claude_code.tool.execution",
      timestamps: at(21),
      params: toolParams,
      ...toolIo,
    },
    {
      span_id: "wait",
      parent_id: "tool",
      trace_id: "t1",
      type: "span",
      name: "claude_code.tool.blocked_on_user",
      timestamps: at(22),
      params: toolParams,
      ...toolIo,
    },
  ];

  /** @scenario "Attributes every span shares are printed once in the digest header" */
  it("prints the attributes every span shares once, before the span tree", async () => {
    const digest = await createTraceApp().formatSpansDigest({ spans });

    expect(digest.split("acme/shop").length - 1).toBe(1);
    expect(digest.split("sess-1").length - 1).toBe(1);
    expect(digest.indexOf("On every span:")).toBeLessThan(
      digest.indexOf("claude_code.interaction"),
    );
  });

  /** @scenario "Token counts are printed once, under the gen_ai.usage keys" */
  it("prints each token count once, under its gen_ai.usage key", async () => {
    const digest = await createTraceApp().formatSpansDigest({ spans });

    expect(digest).toContain("gen_ai.usage.input_tokens: 2");
    expect(digest).toContain("gen_ai.usage.output_tokens: 150");
    expect(digest).not.toMatch(
      /(^|\s)(input_tokens|output_tokens|prompt_tokens|completion_tokens): /m,
    );
    expect(digest).not.toMatch(/\smodel: claude-opus-5/);
  });

  /** @scenario "A child span that repeats its parent's input and output prints neither" */
  it("prints the tool command for the tool span alone and names the repeat on each child", async () => {
    const digest = await createTraceApp().formatSpansDigest({ spans });

    expect(digest.split('{"command":"pnpm test src/cart.test.ts"}').length - 1).toBe(1);
    expect(digest.split("same_as_parent").length - 1).toBe(2);
  });
});
