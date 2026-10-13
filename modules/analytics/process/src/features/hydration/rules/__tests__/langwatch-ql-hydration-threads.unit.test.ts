import type { Trace } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import {
  orderThreadTraces,
  threadTraceIds,
  threadTracesUntil,
} from "../langwatch-ql-hydration-threads.rules.ts";

function trace({ id, startedAt }: { id: string; startedAt: number }): Trace {
  return {
    trace_id: id,
    project_id: "project-1",
    metadata: { thread_id: "thread-a" },
    timestamps: { started_at: startedAt, inserted_at: startedAt, updated_at: startedAt },
    spans: [],
  };
}

describe("orderThreadTraces", () => {
  it("puts the oldest turn first", () => {
    const ordered = orderThreadTraces([
      trace({ id: "b", startedAt: 20 }),
      trace({ id: "a", startedAt: 10 }),
    ]);

    expect(ordered.map((entry) => entry.trace_id)).toEqual(["a", "b"]);
  });

  it("breaks a tie on the trace id, so two identical threads render identically", () => {
    const ordered = orderThreadTraces([
      trace({ id: "z", startedAt: 10 }),
      trace({ id: "a", startedAt: 10 }),
    ]);

    expect(ordered.map((entry) => entry.trace_id)).toEqual(["a", "z"]);
  });
});

describe("threadTracesUntil", () => {
  const traces = [
    trace({ id: "a", startedAt: 10 }),
    trace({ id: "b", startedAt: 20 }),
    trace({ id: "c", startedAt: 30 }),
  ];

  it("keeps the named trace and drops what came after it", () => {
    expect(threadTracesUntil({ traces, untilTraceId: "b" }).map((e) => e.trace_id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("leaves the thread whole for an empty id", () => {
    expect(threadTracesUntil({ traces, untilTraceId: "" })).toHaveLength(3);
  });

  it("leaves the thread whole for an id it does not contain, rather than answering nothing", () => {
    expect(threadTracesUntil({ traces, untilTraceId: "mistyped" })).toHaveLength(3);
  });
});

describe("threadTraceIds", () => {
  it("answers the ids oldest first", () => {
    expect(
      threadTraceIds({
        traces: [trace({ id: "b", startedAt: 20 }), trace({ id: "a", startedAt: 10 })],
      }),
    ).toEqual(["a", "b"]);
  });
});
