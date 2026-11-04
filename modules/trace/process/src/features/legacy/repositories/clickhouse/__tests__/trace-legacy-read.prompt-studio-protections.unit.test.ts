/** @vitest-environment node
 * #8549: the span-only prompt-studio read applies the viewer's attribute
 * policies to the stored rows before any prompt variable is read out of them.
 * Spec: specs/traces-v2/prompt-studio-span-protections.feature */
import { describe, expect, it, vi } from "vitest";

import { TraceLegacyReadClickHouseRepository } from "../trace-legacy-read.repository.ts";

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (_name: string, ...args: unknown[]) => {
      const fn = args.length === 1 ? args[0] : args[1];
      return (fn as (span: unknown) => unknown)({
        setAttribute: () => undefined,
        setAttributes: () => undefined,
        addEvent: () => undefined,
      });
    },
  }),
}));

const ROW = {
  SpanId: "llm-1",
  TraceId: "trace-1",
  ParentSpanId: null,
  SpanName: "llm",
  SpanAttributes: {
    "langwatch.span.type": "llm",
    "gen_ai.request.model": "gpt-test",
    "langwatch.input": JSON.stringify([{ role: "user", content: "question" }]),
    "langwatch.prompt.id": "team/sample-prompt:3",
    "langwatch.prompt.variables": '{"type":"json","value":{"customer":"Alice"}}',
  },
  StartTime: 1_000,
  EndTime: 1_050,
  DurationMs: 50,
  StatusCode: 1,
  StatusMessage: null,
};

function repositoryOverOneRow() {
  return TraceLegacyReadClickHouseRepository.create({
    resolveClickHouseClient: async () =>
      ({ query: async () => ({ json: async () => [ROW] }) }) as never,
  } as never);
}

describe("the span-only prompt-studio read", () => {
  describe("given an attribute policy that hides the prompt variables from the viewer", () => {
    /** @scenario "An attribute a policy hides from the viewer is not read into the prompt" */
    it("derives the span without the hidden values", async () => {
      const span = await repositoryOverOneRow().findSpanForPromptStudio({
        projectId: "project-1",
        spanId: "llm-1",
        protections: {
          canSeeCapturedInput: true,
          canSeeCapturedOutput: true,
          hiddenAttributes: [{ pattern: "langwatch.prompt.variables", visibleTo: "Admins" }],
        },
      });

      expect(span?.llmConfig.model).toBe("gpt-test");
      expect(JSON.stringify(span)).not.toContain("Alice");
    });
  });

  describe("given a viewer no attribute policy restricts", () => {
    it("derives the span with its prompt variables", async () => {
      const span = await repositoryOverOneRow().findSpanForPromptStudio({
        projectId: "project-1",
        spanId: "llm-1",
        protections: { canSeeCapturedInput: true, canSeeCapturedOutput: true },
      });

      expect(span?.promptVariables).toEqual({ customer: "Alice" });
    });
  });
});
