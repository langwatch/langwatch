/**
 * What a judge reads of an agent trace, from the OTLP request through storage to the digest
 * and the LLM span messages. Spec: specs/traces/trace-extraction-modules.feature.
 */
import type { Span } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import {
  deserializeAttributes,
  serializeAttributes,
} from "../../repositories/clickhouse/stored-span-row.mapper.ts";
import { mapNormalizedSpansToSpans } from "../../rules/trace-legacy-span-mapping.rules.ts";
import { extractLlmMessagesForTrace } from "../../rules/trace-llm-messages.rules.ts";
import { formatSpansDigest } from "../../rules/trace-readable-span.rules.ts";
import { SpanNormalizationPipelineService } from "../span-normalization.service.ts";
import { TraceCanonicalisationService } from "../trace-canonicalisation.service.ts";
import {
  genAiToolAgentTrace,
  type JudgeLabTrace,
  langWatchRagTrace,
} from "./fixtures/judge-lab-traces.fixtures.ts";

const pipeline = SpanNormalizationPipelineService.create(TraceCanonicalisationService.create());

function storedSpans({ scope, spans }: JudgeLabTrace): Span[] {
  return mapNormalizedSpansToSpans(
    spans.map((span) => {
      const normalized = pipeline.normalizeSpanReceived({
        tenantId: "project-judge",
        span,
        resource: null,
        instrumentationScope: scope,
      });
      return {
        ...normalized,
        spanAttributes: deserializeAttributes(serializeAttributes(normalized.spanAttributes)),
      };
    }),
  );
}

function ioText(io: Span["input"]): string {
  const value: unknown = io?.value;
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function llmMessagesText(spans: Span[]): string {
  const root = spans.find((span) => !span.parent_id);
  const messages = extractLlmMessagesForTrace({
    trace: {
      input: { value: ioText(root?.input) },
      output: { value: ioText(root?.output) },
    },
    spans,
  });
  return JSON.stringify(messages);
}

const occurrences = (text: string, needle: string) => text.split(needle).length - 1;

describe("given an OTel GenAI agent whose tool ran in an execute_tool span", () => {
  const trace = genAiToolAgentTrace();

  /** @scenario "A judge reading an OTel GenAI agent trace sees the tool call and its result once" */
  it("types the execute_tool span as a tool span", () => {
    const tool = storedSpans(trace).find((span) => span.name === "execute_tool get_rates");

    expect(tool?.type).toBe("tool");
    expect(tool?.input).toEqual({
      type: "json",
      value: expect.objectContaining({ unitCode: "DV-6" }),
    });
    expect(tool?.output).toEqual({
      type: "json",
      value: expect.objectContaining({ cleaningFee: 65 }),
    });
  });

  /** @scenario "A judge reading an OTel GenAI agent trace sees the tool call and its result once" */
  it("prints the tool's arguments and result once in the digest", async () => {
    const digest = await formatSpansDigest(storedSpans(trace));
    const toolBlock = digest.slice(digest.indexOf("execute_tool get_rates"));
    const toolLines = toolBlock.slice(0, toolBlock.indexOf("\n\n"));

    expect(toolLines).toContain("span.type: tool");
    expect(toolLines).toContain("gen_ai.tool.name: get_rates");
    expect(occurrences(toolLines, "DV-6")).toBe(1);
    expect(occurrences(toolLines, "139.5")).toBe(1);
  });

  /** @scenario "A judge reading an OTel GenAI agent trace sees the tool call and its result once" */
  it("keeps the tool result in the LLM span messages", () => {
    const text = llmMessagesText(storedSpans(trace));

    for (const witness of trace.witnesses) expect(text).toContain(witness);
    expect(text).toContain('"role":"tool"');
  });
});

describe("given a RAG call whose retrieved passages sit in a later system message", () => {
  const trace = langWatchRagTrace();

  /** @scenario "Retrieved passages in a later system message reach the LLM span messages" */
  it("keeps the passages in the LLM span messages", () => {
    const text = llmMessagesText(storedSpans(trace));

    for (const witness of trace.witnesses) expect(text).toContain(witness);
  });

  /** @scenario "Retrieved passages in a later system message reach the LLM span messages" */
  it("starts the input with the system prompt, once", () => {
    const messages = extractLlmMessagesForTrace({
      trace: {},
      spans: storedSpans(trace),
    });

    expect(messages?.input.map((message) => message.role)).toEqual(["system", "user", "system"]);
    expect(JSON.stringify(messages?.input[0]?.content)).toContain("bid-management companion");
  });

  /** @scenario "Retrieved passages in a later system message reach the LLM span messages" */
  it("keeps the passages in the digest", async () => {
    const digest = await formatSpansDigest(storedSpans(trace));

    for (const witness of trace.witnesses) expect(digest).toContain(witness);
  });
});
