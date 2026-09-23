import type { Trace } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { collectLangWatchQLKeys } from "../../rules/langwatch-ql-hydration-plan.rules.ts";
import {
  LangWatchQLHydrationReadService,
  LWQL_TRACES_PER_THREAD_CEILING,
  type LangWatchQLTraceSource,
} from "../langwatch-ql-hydration-read.service.ts";

function trace({ id, threadId = "thread-a" }: { id: string; threadId?: string }): Trace {
  return {
    trace_id: id,
    project_id: "project-1",
    metadata: { thread_id: threadId },
    timestamps: { started_at: 1, inserted_at: 1, updated_at: 1 },
    spans: [],
  };
}

function traceSource(overrides: Partial<LangWatchQLTraceSource> = {}): LangWatchQLTraceSource {
  return {
    readTraces: async ({ traceIds }) => traceIds.map((id) => trace({ id })),
    readThreadTraces: async () => [],
    ...overrides,
  };
}

function resolvedTraceCall(traceIds: readonly string[]) {
  return collectLangWatchQLKeys({
    calls: [{ column: "trace", function: "trace_json", options: [] }],
    rows: traceIds.map((id) => ({ trace: id })),
  });
}

const readInput = {
  projectIds: ["project-1"],
  protections: {},
  maxReadBytes: 128_000_000,
};

describe("LangWatchQLHydrationReadService", () => {
  it("indexes the traces by id, so one read serves every call over the same rows", async () => {
    const service = LangWatchQLHydrationReadService.create({ traces: traceSource() });

    const fetched = await service.readTraces({
      ...readInput,
      resolved: resolvedTraceCall(["trace-a", "trace-b"]),
    });

    expect([...fetched.byId.keys()]).toEqual(["trace-a", "trace-b"]);
  });

  it("reads the keys in chunks rather than one call, so the budget can stop it near the line", async () => {
    const readTraces = vi.fn(async ({ traceIds }: { traceIds: readonly string[] }) =>
      traceIds.map((id) => trace({ id })),
    );
    const service = LangWatchQLHydrationReadService.create({
      traces: traceSource({ readTraces }),
    });

    await service.readTraces({
      ...readInput,
      resolved: resolvedTraceCall(Array.from({ length: 60 }, (_, index) => `trace-${index}`)),
    });

    expect(readTraces).toHaveBeenCalledTimes(3);
  });

  it("asks every project the caller can read, since the trace path filters on one tenant", async () => {
    const readTraces = vi.fn(
      async ({ projectId, traceIds }: { projectId: string; traceIds: readonly string[] }) =>
        traceIds.map((id) => trace({ id: `${projectId}:${id}` })),
    );
    const service = LangWatchQLHydrationReadService.create({
      traces: traceSource({ readTraces }),
    });

    await service.readTraces({
      ...readInput,
      projectIds: ["project-1", "project-2"],
      resolved: resolvedTraceCall(["trace-a"]),
    });

    expect(readTraces.mock.calls.map(([input]) => input.projectId)).toEqual([
      "project-1",
      "project-2",
    ]);
  });

  /** @scenario "A read past the byte budget is refused, not completed" */
  it("refuses by name once the traces read weigh more than the budget", async () => {
    const service = LangWatchQLHydrationReadService.create({ traces: traceSource() });

    await expect(
      service.readTraces({
        ...readInput,
        maxReadBytes: 10,
        resolved: resolvedTraceCall(["trace-a", "trace-b"]),
      }),
    ).rejects.toMatchObject({ code: "lwql_app_function_read_budget" });
  });

  /** @scenario "A page of conversations never loses a trace to the read's ceiling" */
  it("asks each thread read for a ceiling sized by its threads, not the read's default", async () => {
    const asked: { threadKeys: readonly string[]; maxTraces: number }[] = [];
    const service = LangWatchQLHydrationReadService.create({
      traces: traceSource({
        readThreadTraces: async ({ threadKeys, maxTraces }) => {
          asked.push({ threadKeys, maxTraces });
          return [];
        },
      }),
    });
    const threads = Array.from({ length: 12 }, (_, index) => `thread-${index}`);

    await service.readTraces({
      ...readInput,
      resolved: collectLangWatchQLKeys({
        calls: [{ column: "transcript", function: "conversation", options: [] }],
        rows: threads.map((thread) => ({ transcript: thread })),
      }),
    });

    expect(asked.map((read) => read.maxTraces)).toEqual(
      asked.map((read) => read.threadKeys.length * LWQL_TRACES_PER_THREAD_CEILING),
    );
    expect(asked.flatMap((read) => read.threadKeys)).toEqual(threads);
  });

  it("reads no thread at all when no row named one", async () => {
    let reads = 0;
    const service = LangWatchQLHydrationReadService.create({
      traces: traceSource({
        readThreadTraces: async () => {
          reads += 1;
          return [];
        },
      }),
    });

    await service.readTraces({ ...readInput, resolved: [] });

    expect(reads).toBe(0);
  });

  it("groups a thread read back by the thread each trace belongs to", async () => {
    const service = LangWatchQLHydrationReadService.create({
      traces: traceSource({
        readThreadTraces: async () => [
          trace({ id: "trace-a", threadId: "thread-a" }),
          trace({ id: "trace-b", threadId: "thread-b" }),
          // A key nobody asked for: dropped rather than grouped, since keeping
          // it would put content in a cell whose key never named it.
          trace({ id: "trace-c", threadId: "thread-elsewhere" }),
        ],
      }),
    });

    const fetched = await service.readTraces({
      ...readInput,
      resolved: collectLangWatchQLKeys({
        calls: [{ column: "transcript", function: "conversation", options: [] }],
        rows: [{ transcript: "thread-a" }, { transcript: "thread-b" }],
      }),
    });

    expect([...fetched.byThread.keys()]).toEqual(["thread-a", "thread-b"]);
  });

  /** @scenario "A failed fetch is a platform failure, not a wrong answer" */
  it("turns a read that broke into a platform-fault refusal rather than null columns", async () => {
    const service = LangWatchQLHydrationReadService.create({
      traces: traceSource({
        readTraces: async () => {
          throw new Error("clickhouse said no");
        },
      }),
    });

    await expect(
      service.readTraces({ ...readInput, resolved: resolvedTraceCall(["trace-a"]) }),
    ).rejects.toMatchObject({ code: "lwql_app_function_hydration_failed", fault: "platform" });
  });

  /** @scenario "A cancelled read stops between chunks" */
  it("answers the caller's cancellation with the abort, not with a read failure", async () => {
    const service = LangWatchQLHydrationReadService.create({ traces: traceSource() });

    await expect(
      service.readTraces({
        ...readInput,
        resolved: resolvedTraceCall(["trace-a"]),
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
