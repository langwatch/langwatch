import { describe, expect, it } from "vitest";

import {
  formatRun,
  isBatchDone,
  matchScenarioIds,
  resolvePlanIds,
  retryPlanBody,
  summaryLine,
  unwrapList,
} from "./run-report.ts";

describe("matchScenarioIds", () => {
  const scenarios = [
    { id: "a", name: "E2E core 91: metrics" },
    { id: "b", name: "E2E dogfood 154: x" },
    { id: "c", name: "E2E core 910: other" },
    { id: "d", name: "W1: quiet" },
  ];

  it("matches the line number exactly, not as a prefix", () => {
    expect(matchScenarioIds({ scenarios, numbers: ["91", "154"] })).toEqual(["a", "b"]);
  });

  it("ignores names outside the E2E shape", () => {
    expect(matchScenarioIds({ scenarios, numbers: ["1"] })).toEqual([]);
  });
});

describe("batch reading", () => {
  const runs = [
    { status: "SUCCESS", name: "one", results: { reasoning: "x".repeat(300) } },
    { status: "failed", scenarioId: "s2", results: null },
  ];

  it("formats a run with the reasoning cut to 200 characters", () => {
    expect(formatRun({ run: runs[0]! })).toBe(`SUCCESS | one | ${"x".repeat(200)}`);
    expect(formatRun({ run: runs[1]! })).toBe("failed | s2 | ");
  });

  it("summarises passed over total", () => {
    expect(summaryLine({ runs })).toBe("overall: 1/2 passed");
    expect(summaryLine({ runs: [] })).toBe("overall: 0/0 passed");
  });

  it("is done only when runs exist and all are final", () => {
    expect(isBatchDone({ runs })).toBe(true);
    expect(isBatchDone({ runs: [] })).toBe(false);
    expect(isBatchDone({ runs: [...runs, { status: "RUNNING" }] })).toBe(false);
  });
});

describe("unwrapList", () => {
  it("accepts a bare array or a wrapped one, and refuses anything else", () => {
    expect(unwrapList({ body: [1] })).toEqual([1]);
    expect(unwrapList({ body: { data: [2] } })).toEqual([2]);
    expect(() => unwrapList({ body: { error: "no" } })).toThrow(/expected a list/);
  });
});

describe("run plans", () => {
  it("resolves plan names to ids and names the missing one", () => {
    const plans = [{ id: "p1", name: "A" }];
    expect(resolvePlanIds({ plans, names: ["A"] })).toEqual([{ name: "A", id: "p1" }]);
    expect(() => resolvePlanIds({ plans, names: ["B"] })).toThrow('no run plan named "B"');
  });

  it("builds the retry body against the connected agent", () => {
    expect(retryPlanBody({ scenarioIds: ["a"], agentId: "agent_1" })).toEqual({
      name: "Langy e2e retry",
      config: {
        scope: { mode: "scenarios" },
        scenarioIds: ["a"],
        targets: [{ type: "connected", referenceId: "agent_1" }],
        repeatCount: 1,
      },
    });
  });
});
