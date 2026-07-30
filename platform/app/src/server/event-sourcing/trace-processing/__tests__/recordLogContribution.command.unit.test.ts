import { describe, expect, it } from "vitest";
import { recordLogContribution } from "../recordLogContribution.command";
import { TRACE_ID } from "./fixtures";

describe("the recordLogContribution command", () => {
  it("emits exactly the logContributed event, bridging a log record into the trace", async () => {
    const input = {
      traceId: TRACE_ID,
      spanId: "s1",
      recordId: "r-1",
      timeUnixMs: 1,
      severityNumber: 9,
      severityText: "INFO",
      body: "line",
      attributes: {},
      resourceAttributes: {},
      scopeName: "scope",
      scopeVersion: null,
      piiRedactionLevel: "ESSENTIAL" as const,
    };
    expect(await recordLogContribution(input)).toEqual([
      { type: "logContributed", data: input },
    ]);
  });
});
