import type {
  LangWatchQLExecuteInput,
  LangWatchQLQueryResult,
} from "@langwatch/analytics-contract";
import type { Trace } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import {
  LangWatchQLHydrationComputeService,
  type LangWatchQLTraceRenderer,
} from "../langwatch-ql-hydration-compute.service.ts";
import {
  LangWatchQLHydrationReadService,
  type LangWatchQLTraceSource,
} from "../langwatch-ql-hydration-read.service.ts";
import { LangWatchQLHydrationService } from "../langwatch-ql-hydration.service.ts";

function trace({ id, threadId = "thread-a" }: { id: string; threadId?: string }): Trace {
  return {
    trace_id: id,
    project_id: "project-1",
    metadata: { thread_id: threadId },
    timestamps: { started_at: 1, inserted_at: 1, updated_at: 1 },
    spans: [],
  };
}

const renderer: LangWatchQLTraceRenderer = {
  renderThreadTranscript: async () => "### the transcript",
  renderReadableTrace: async () => "the digest",
  renderTraceMessages: async () => "{}",
  renderSpanMessages: async () => ({ isSpanPresent: true, json: "{}" }),
  renderTraceJson: async () => "{}",
};

const traceSource: LangWatchQLTraceSource = {
  readTraces: async ({ traceIds }) => traceIds.map((id) => trace({ id })),
  readThreadTraces: async () => [trace({ id: "trace-a", threadId: "thread-a" })],
};

function emptyResult(rows: readonly Record<string, unknown>[]): LangWatchQLQueryResult {
  return {
    columns: [{ name: "transcript", type: "String" }],
    rows,
    statistics: { elapsedMs: 1, rowsRead: rows.length, bytesRead: 1, rowsReturned: rows.length },
    truncated: false,
    diagnostics: [],
    followsTimeWindow: true,
    followsGranularity: true,
  };
}

function hydrationService({
  execute = vi.fn(async (_input: LangWatchQLExecuteInput): Promise<LangWatchQLQueryResult> =>
    emptyResult([{ transcript: "thread-a" }]),
  ),
} = {}) {
  return {
    execute,
    service: LangWatchQLHydrationService.create({
      reads: LangWatchQLHydrationReadService.create({ traces: traceSource }),
      compute: LangWatchQLHydrationComputeService.create({ renderer }),
      runner: { executeLangWatchQL: execute },
    }),
  };
}

const caller = { project: { id: "project-1", lwqlKey: "key" }, protections: {} };

describe("LangWatchQLHydrationService.hydrate", () => {
  /** @scenario "A statement that calls no app function records an empty plan" */
  it("returns the result unchanged, and reads nothing, when nothing was called", async () => {
    const readTraces = vi.fn(async () => []);
    const service = LangWatchQLHydrationService.create({
      reads: LangWatchQLHydrationReadService.create({
        traces: { ...traceSource, readTraces },
      }),
      compute: LangWatchQLHydrationComputeService.create({ renderer }),
      runner: { executeLangWatchQL: async () => emptyResult([]) },
    });
    const rows = [{ ConversationId: "thread-a" }];

    const result = await service.hydrate({
      projectIds: ["project-1"],
      protections: {},
      calls: [],
      columns: [{ name: "ConversationId", type: "String" }],
      rows,
    });

    expect(result.rows).toBe(rows);
    expect(readTraces).not.toHaveBeenCalled();
  });

  /** @scenario "The hydrated column carries the rendered conversation, not the thread key" */
  it("replaces the key with the value it names", async () => {
    const { service } = hydrationService();

    const result = await service.hydrate({
      projectIds: ["project-1"],
      protections: {},
      calls: [{ column: "transcript", function: "conversation", options: [] }],
      columns: [{ name: "transcript", type: "String" }],
      rows: [{ transcript: "thread-a" }],
    });

    expect(result.rows).toEqual([{ transcript: "### the transcript" }]);
  });

  /** @scenario "More distinct thread keys than the thread cap allows is refused the same way" */
  it("checks the caps before any fetch", async () => {
    const readThreadTraces = vi.fn(async () => []);
    const service = LangWatchQLHydrationService.create({
      reads: LangWatchQLHydrationReadService.create({
        traces: { ...traceSource, readThreadTraces },
      }),
      compute: LangWatchQLHydrationComputeService.create({ renderer }),
      runner: { executeLangWatchQL: async () => emptyResult([]) },
    });

    await expect(
      service.hydrate({
        projectIds: ["project-1"],
        protections: {},
        calls: [{ column: "transcript", function: "conversation", options: [] }],
        columns: [{ name: "transcript", type: "String" }],
        rows: Array.from({ length: 5_000 }, (_, index) => ({ transcript: `thread-${index}` })),
      }),
    ).rejects.toMatchObject({ code: "lwql_app_function_key_cap" });
    expect(readThreadTraces).not.toHaveBeenCalled();
  });
});

describe("LangWatchQLHydrationService.hydrateTexts", () => {
  it("restricts the caller's own statement to the traces asked about", async () => {
    const { execute, service } = hydrationService();

    await service.hydrateTexts({
      ...caller,
      sql: "SELECT TraceId FROM analytics.traces",
      parameters: { since: "yesterday" },
      calls: [{ column: "transcript", function: "conversation", options: [] }],
      traceIds: ["trace-a"],
    });

    const [input] = execute.mock.calls[0] ?? [];
    expect(input?.sql).toContain("lwql_hydration_trace_ids");
    expect(input?.parameters).toEqual({
      since: "yesterday",
      lwql_hydration_trace_ids: ["trace-a"],
    });
  });

  it("answers the text an eval would judge rather than a verdict, calling no judge", async () => {
    const { service } = hydrationService();

    const rows = await service.hydrateTexts({
      ...caller,
      sql: "SELECT ConversationId FROM analytics.traces",
      calls: [
        {
          column: "transcript",
          function: "eval",
          options: ["is it polite?"],
          source: { function: "conversation", options: [] },
        },
      ],
      traceIds: ["trace-a"],
    });

    expect(rows).toEqual([{ transcript: "### the transcript" }]);
  });

  it("reads nothing when no trace was named", async () => {
    const { execute, service } = hydrationService();

    expect(
      await service.hydrateTexts({
        ...caller,
        sql: "SELECT 1",
        calls: [{ column: "transcript", function: "conversation", options: [] }],
        traceIds: [],
      }),
    ).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
});
