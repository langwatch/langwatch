import { describe, expect, it } from "vitest";

import { runSchema, scenarioBlock, statusSchema } from "../mcp-api.ts";
import { wireRun, wireStatus } from "./fake-sim.ts";

describe("the MCP sim's wire types", () => {
  it("parses a status with its grant, scenarios and runs", () => {
    const status = statusSchema.parse(wireStatus);

    expect(status.oauth.connected).toBe(true);
    expect(status.scenarios).toHaveLength(4);
    expect(status.runs[0]?.state).toBe("failed");
  });

  it("parses a run with steps, checks and load, and null lists as empty", () => {
    const run = runSchema.parse(wireRun);
    const bare = runSchema.parse({ ...wireRun, steps: null, checks: null, transports: null });

    expect(run.steps[0]?.status).toBe(503);
    expect(run.load?.latency?.p99).toBe(88.2);
    expect(bare.steps).toEqual([]);
    expect(bare.checks).toEqual([]);
  });

  /** @scenario "The console tells which scenarios a flow can run" */
  it("blocks an oauth-only scenario on the apikey flow and any oauth run without a grant", () => {
    const refresh = { name: "refresh", summary: "", flows: ["oauth"] };
    const connect = { name: "connect", summary: "", flows: ["apikey", "oauth"] };

    expect(scenarioBlock({ scenario: refresh, flow: "apikey", connected: true })).not.toBe("");
    expect(scenarioBlock({ scenario: connect, flow: "oauth", connected: false })).not.toBe("");
    expect(scenarioBlock({ scenario: connect, flow: "oauth", connected: true })).toBe("");
    expect(scenarioBlock({ scenario: connect, flow: "apikey", connected: false })).toBe("");
  });
});
