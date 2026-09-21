import type { Trace } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { collectLangWatchQLKeys } from "../../rules/langwatch-ql-hydration-plan.rules.ts";
import {
  LangWatchQLHydrationComputeService,
  type LangWatchQLTraceRenderer,
} from "../langwatch-ql-hydration-compute.service.ts";
import type { LangWatchQLFetchedTraces } from "../langwatch-ql-hydration-read.service.ts";

function trace({ id, threadId = "thread-a" }: { id: string; threadId?: string }): Trace {
  return {
    trace_id: id,
    project_id: "project-1",
    metadata: { thread_id: threadId },
    timestamps: { started_at: 1, inserted_at: 1, updated_at: 1 },
    spans: [],
  };
}

function renderer(overrides: Partial<LangWatchQLTraceRenderer> = {}): LangWatchQLTraceRenderer {
  return {
    renderThreadTranscript: async () => "### the transcript",
    renderReadableTrace: async () => "the digest",
    renderTraceMessages: async () => '{"input":[],"output":[]}',
    renderSpanMessages: async () => ({ isSpanPresent: true, json: "{}" }),
    renderTraceJson: async () => '{"trace_id":"trace-a"}',
    ...overrides,
  };
}

const NO_TRACES: LangWatchQLFetchedTraces = { byId: new Map(), byThread: new Map() };

function fetched({
  byId = [],
  byThread = [],
}: {
  byId?: readonly Trace[];
  byThread?: readonly (readonly [string, readonly Trace[]])[];
}): LangWatchQLFetchedTraces {
  return {
    byId: new Map(byId.map((entry) => [entry.trace_id, entry])),
    byThread: new Map(byThread),
  };
}

const MAX_VALUE_BYTES = 4_000_000;

describe("LangWatchQLHydrationComputeService", () => {
  it("renders a thread through the transcript the product already shows", async () => {
    const renderThreadTranscript = vi.fn(async () => "### the transcript");
    const service = LangWatchQLHydrationComputeService.create({
      renderer: renderer({ renderThreadTranscript }),
    });
    const rows = [{ transcript: "thread-a" }];

    const computed = await service.computeValues({
      resolved: collectLangWatchQLKeys({
        calls: [{ column: "transcript", function: "conversation", options: [] }],
        rows,
      }),
      traces: fetched({ byThread: [["thread-a", [trace({ id: "trace-a" })]]] }),
      maxHydratedValueBytes: MAX_VALUE_BYTES,
    });

    expect(computed.get("transcript")?.get('["thread-a"]')?.value).toBe("### the transcript");
    expect(renderThreadTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ threadKey: "thread-a" }),
    );
  });

  it("passes conversation_bounded's own budget and cut through to the renderer", async () => {
    let asked: { threadKey: string; traces: readonly Trace[]; maxTokens?: number } | undefined;
    const service = LangWatchQLHydrationComputeService.create({
      renderer: renderer({
        renderThreadTranscript: async (input) => {
          asked = input;
          return "### cut";
        },
      }),
    });
    const traces = [trace({ id: "trace-a" }), trace({ id: "trace-b" })];

    await service.computeValues({
      resolved: collectLangWatchQLKeys({
        calls: [
          { column: "transcript", function: "conversation_bounded", options: [1_000, "trace-a"] },
        ],
        rows: [{ transcript: "thread-a" }],
      }),
      traces: fetched({ byThread: [["thread-a", traces]] }),
      maxHydratedValueBytes: MAX_VALUE_BYTES,
    });

    expect(asked?.maxTokens).toBe(1_000);
    expect(asked?.traces.map((entry) => entry.trace_id)).toEqual(["trace-a"]);
  });

  it("answers thread_traces from the traces themselves, reading nothing", async () => {
    const service = LangWatchQLHydrationComputeService.create({ renderer: renderer() });

    const computed = await service.computeValues({
      resolved: collectLangWatchQLKeys({
        calls: [{ column: "ids", function: "thread_traces", options: [] }],
        rows: [{ ids: "thread-a" }],
      }),
      traces: fetched({
        byThread: [
          [
            "thread-a",
            [
              {
                ...trace({ id: "trace-b" }),
                timestamps: { started_at: 2, inserted_at: 2, updated_at: 2 },
              },
              trace({ id: "trace-a" }),
            ],
          ],
        ],
      }),
      maxHydratedValueBytes: MAX_VALUE_BYTES,
    });

    expect(computed.get("ids")?.get('["thread-a"]')?.value).toEqual(["trace-a", "trace-b"]);
  });

  /** @scenario "A span the trace does not hold is an unresolved key" */
  it("counts a span the trace does not carry as unresolved, and an empty one as resolved", async () => {
    const service = LangWatchQLHydrationComputeService.create({
      renderer: renderer({
        renderSpanMessages: async ({ spanId }) =>
          spanId === "absent"
            ? { isSpanPresent: false, json: null }
            : { isSpanPresent: true, json: null },
      }),
    });

    const computed = await service.computeValues({
      resolved: collectLangWatchQLKeys({
        calls: [{ column: "messages", function: "llm_messages_span", options: [] }],
        rows: [{ messages: ["trace-a", "absent"] }, { messages: ["trace-a", "empty"] }],
      }),
      traces: fetched({ byId: [trace({ id: "trace-a" })] }),
      maxHydratedValueBytes: MAX_VALUE_BYTES,
    });

    expect(computed.get("messages")?.get('["trace-a","absent"]')?.isResolved).toBe(false);
    expect(computed.get("messages")?.get('["trace-a","empty"]')?.isResolved).toBe(true);
  });

  it("leaves a key that matched no trace unresolved rather than asking the renderer", async () => {
    const renderTraceJson = vi.fn(async () => "{}");
    const service = LangWatchQLHydrationComputeService.create({
      renderer: renderer({ renderTraceJson }),
    });

    const computed = await service.computeValues({
      resolved: collectLangWatchQLKeys({
        calls: [{ column: "trace", function: "trace_json", options: [] }],
        rows: [{ trace: "trace-missing" }],
      }),
      traces: NO_TRACES,
      maxHydratedValueBytes: MAX_VALUE_BYTES,
    });

    expect(computed.get("trace")?.get('["trace-missing"]')?.isResolved).toBe(false);
    expect(renderTraceJson).not.toHaveBeenCalled();
  });

  it("computes nothing for an eval call: a judgement is not this stage's answer", async () => {
    const service = LangWatchQLHydrationComputeService.create({ renderer: renderer() });

    const computed = await service.computeValues({
      resolved: collectLangWatchQLKeys({
        calls: [{ column: "verdict", function: "eval", options: ["is it polite?"] }],
        rows: [{ verdict: "some text" }],
      }),
      traces: NO_TRACES,
      maxHydratedValueBytes: MAX_VALUE_BYTES,
    });

    expect(computed.size).toBe(0);
  });

  it("refuses a numeric option the plan recorded as something else, loudly", async () => {
    const service = LangWatchQLHydrationComputeService.create({ renderer: renderer() });

    await expect(
      service.computeValues({
        resolved: collectLangWatchQLKeys({
          calls: [{ column: "text", function: "llm_readable_trace", options: ["not a number"] }],
          rows: [{ text: "trace-a" }],
        }),
        traces: fetched({ byId: [trace({ id: "trace-a" })] }),
        maxHydratedValueBytes: MAX_VALUE_BYTES,
      }),
    ).rejects.toMatchObject({ code: "lwql_app_function_hydration_failed" });
  });
});
