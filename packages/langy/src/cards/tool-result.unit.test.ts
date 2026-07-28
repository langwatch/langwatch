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

  it("types a simulation-run get as the simulationRun card when it carries the run id", () => {
    expect(
      toCliToolResult({
        resource: "simulation-run",
        verb: "get",
        payload: { scenarioRunId: "run_1", status: "SUCCESS" },
      }),
    ).toEqual({
      kind: "card",
      card: "simulationRun",
      payload: { scenarioRunId: "run_1", status: "SUCCESS" },
    });
  });

  it("degrades a simulation-run get WITHOUT the structured run id to a json receipt", () => {
    // The id is the card's contract — the panel fetches live state by it. A
    // payload that lacks it must never become a live card off a guess.
    expect(
      toCliToolResult({
        resource: "simulation-run",
        verb: "get",
        payload: { status: "SUCCESS" },
      }),
    ).toEqual({ kind: "json", payload: { status: "SUCCESS" } });
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
