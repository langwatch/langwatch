import {
  SPAN_MAX_PAST_MS,
  spanTreeCursorSchema,
  spanTreeNodeSchema,
  spanTreePageSchema,
  spanTreeTransportInputSchema,
} from "../src";
import { describe, expect, it } from "vitest";

type LiveSpanTreeNodeShape = {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  type: string | null;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  status: "ok" | "error" | "unset";
  model: string | null;
  toolName?: string | null;
  cost?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheCreationTokens?: number | null;
  updatedAtMs?: number | null;
};

type ContractNode = import("../src").SpanTreeNode;
type NodeParity = [ContractNode] extends [LiveSpanTreeNodeShape]
  ? [LiveSpanTreeNodeShape] extends [ContractNode]
    ? true
    : false
  : false;
const nodeParity: NodeParity = true;

describe("Trace span-tree contract", () => {
  it("publishes the ingestion age limit for every transport", () => {
    expect(SPAN_MAX_PAST_MS).toBe(31 * 24 * 60 * 60 * 1000);
  });

  it("characterizes every live tracesV2 SpanTreeNode field", () => {
    expect(nodeParity).toBe(true);
    const node = spanTreeNodeSchema.parse({
      spanId: "span_1",
      parentSpanId: null,
      name: "root",
      type: "llm",
      startTimeMs: 1,
      endTimeMs: 2,
      durationMs: 1,
      status: "ok",
      model: "gpt-4o",
      toolName: null,
      cost: 0.01,
      inputTokens: 12,
      outputTokens: 8,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      updatedAtMs: 2,
    });

    expect(node).toMatchObject({ spanId: "span_1", cost: 0.01 });
  });

  it("preserves the live nullish optional fields", () => {
    expect(
      spanTreeNodeSchema.parse({
        spanId: "span_1",
        parentSpanId: null,
        name: "root",
        type: null,
        startTimeMs: 1,
        endTimeMs: 2,
        durationMs: 1,
        status: "unset",
        model: null,
      }),
    ).toMatchObject({ spanId: "span_1", model: null });
  });

  it("rejects an invalid cursor and returns the exact page shape", () => {
    expect(() => spanTreeCursorSchema.parse({ startTimeMs: -1, spanId: "span_1" })).toThrow();
    expect(
      spanTreePageSchema.parse({
        nodes: [],
        nextCursor: { startTimeMs: 2, spanId: "span_1" },
      }),
    ).toEqual({
      nodes: [],
      nextCursor: { startTimeMs: 2, spanId: "span_1" },
    });
  });

  it("keeps authorization out of the wire input", () => {
    expect(
      spanTreeTransportInputSchema.parse({
        projectId: "project_1",
        traceId: "trace_1",
        limit: 200,
      }),
    ).toEqual({
      projectId: "project_1",
      traceId: "trace_1",
      limit: 200,
    });
  });
});
