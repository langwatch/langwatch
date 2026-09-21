import type { Trace } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { collectLangWatchQLKeys } from "../../rules/langwatch-ql-hydration-plan.rules.ts";
import {
  LangWatchQLHydrationReadService,
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
