/**
 * @vitest-environment node
 * @see specs/scenarios/judge-trace-wait-settings.feature
 */
import { describe, expect, it } from "vitest";

import { resolveRunTraceWait } from "../features/run/run-trace-wait.ts";
import { scenarioUpdateInputSchema } from "../scenario.ts";

const project = { traceQuietPeriodMs: 7_000, traceWaitTimeoutMs: 30_000 };

describe("resolveRunTraceWait", () => {
  it("takes each setting from the plan, then the scenario, then the project", () => {
    expect(
      resolveRunTraceWait({
        plan: { traceQuietPeriodMs: 20_000 },
        scenario: { traceQuietPeriodMs: 10_000, traceWaitTimeoutMs: 90_000 },
        project,
      }),
    ).toEqual({ traceQuietPeriodMs: 20_000, traceWaitTimeoutMs: 90_000 });
    expect(
      resolveRunTraceWait({ plan: {}, scenario: { traceQuietPeriodMs: null }, project }),
    ).toEqual(project);
  });

  it("keeps a zero quiet period rather than falling through", () => {
    expect(
      resolveRunTraceWait({ plan: {}, scenario: { traceQuietPeriodMs: 0 }, project }),
    ).toMatchObject({ traceQuietPeriodMs: 0 });
  });
});

describe("scenario trace wait bounds", () => {
  const update = (fields: Record<string, unknown>) =>
    scenarioUpdateInputSchema.safeParse({ id: "scenario_1", projectId: "project_1", ...fields });

  /** @scenario "Trace wait settings outside their bounds are refused" */
  it.each([
    [{ traceQuietPeriodMs: 60_001 }, false],
    [{ traceQuietPeriodMs: -1 }, false],
    [{ traceQuietPeriodMs: 1.5 }, false],
    [{ traceWaitTimeoutMs: 999 }, false],
    [{ traceWaitTimeoutMs: 300_001 }, false],
    [{ traceQuietPeriodMs: 0, traceWaitTimeoutMs: 1_000 }, true],
    [{ traceQuietPeriodMs: 60_000, traceWaitTimeoutMs: 300_000 }, true],
    [{ traceQuietPeriodMs: null, traceWaitTimeoutMs: null }, true],
  ] as const)("judges %j valid: %s", (fields, valid) => {
    expect(update(fields).success).toBe(valid);
  });
});
