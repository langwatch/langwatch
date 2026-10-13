import { describe, expect, it } from "vitest";

import { instantEvalProcessStateSchema } from "../instant-eval-processing-data.process.ts";

describe("process state stored by the main release", () => {
  it("parses an instant evaluation state as main stored it", () => {
    expect(
      instantEvalProcessStateSchema.parse({
        phase: "running",
        page: 2,
        cursor: "trace_1",
        cursorSpanId: null,
        pageSize: 50,
        keyColumns: ["trace_id"],
        remaining: 10,
        inputTokens: 100,
        requests: 2,
        lastActivityAtMs: 1,
        cancelRequestedAtMs: null,
      }),
    ).toEqual({
      phase: "running",
      page: 2,
      cursor: "trace_1",
      cursorSpanId: null,
      pageSize: 50,
      keyColumns: ["trace_id"],
      remaining: 10,
      inputTokens: 100,
      requests: 2,
      lastActivityAtMs: 1,
      cancelRequestedAtMs: null,
    });
  });
});
