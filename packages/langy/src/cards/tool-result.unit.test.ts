import { describe, expect, it } from "vitest";
import {
  parseCliToolResult,
  toCliTextResult,
  toCliToolResult,
} from "./tool-result.js";

describe("CLI tool result contract", () => {
  it("creates a typed trace-search payload", () => {
    expect(
      toCliToolResult({
        resource: "trace",
        verb: "search",
        payload: { traces: [{ trace_id: "trace_1" }], pagination: { totalHits: 1 } },
      }),
    ).toMatchObject({ kind: "card", card: "traces" });
  });

  it("does not mistake an unrelated scalar envelope for a trace result", () => {
    expect(parseCliToolResult('{"value":"previous tool output"}')).toBeNull();
  });

  it("retains an un-carded JSON response as a typed receipt", () => {
    expect(
      toCliToolResult({
        resource: "analytics",
        verb: "query",
        payload: { value: "previous tool output" },
      }),
    ).toEqual({ kind: "json", payload: { value: "previous tool output" } });
  });

  it("retains non-JSON stdout as a typed text receipt", () => {
    const result = toCliTextResult("Trace ID   Input\ntrace_1    hello");
    expect(parseCliToolResult(JSON.stringify(result))).toEqual(result);
  });
});
