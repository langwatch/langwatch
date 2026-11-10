/**
 * The scenario run notices process manager: the heads-up once per month, the grace end once.
 * @see specs/licensing/cloud-free-creation-caps.feature
 */
import type { ScenarioRunsCountedEventData } from "@langwatch/entitlement-contract";
import { describe, expect, it } from "vitest";

import { DAY_MS } from "../../rules/scenario-run-cap.rules.ts";
import {
  initialScenarioRunNoticesState,
  scenarioRunGraceWake,
  scenarioRunsCounted,
  type ScenarioRunNoticesState,
} from "../scenario-run-notices.process.ts";

type CountedCtx = Parameters<typeof scenarioRunsCounted>[2];

const now = Date.UTC(2026, 10, 20, 12);
const ctx = (at: number) =>
  ({
    at,
    now: at,
    key: "org-1",
    intent: (name: string, key: string, data: Record<string, unknown>) => ({ name, key, data }),
  }) as CountedCtx;

const counted = (over: Partial<ScenarioRunsCountedEventData> = {}) =>
  ({
    organizationId: "org-1",
    month: "2026-11",
    occurredAt: now,
    runs: 80,
    firstRunAt: now - 3 * DAY_MS,
    cap: { maxPerMonth: 100, graceDays: 14 },
    ...over,
  }) as ScenarioRunsCountedEventData;

const intentNames = (result: { intents?: readonly unknown[] }) =>
  (result.intents ?? []).map((intent) => (intent as { name: string }).name);

describe("scenarioRunsCounted", () => {
  /** @scenario Reaching 80 runs in a month records the threshold once */
  it("records the threshold once for the month", () => {
    const first = scenarioRunsCounted(initialScenarioRunNoticesState, counted(), ctx(now));
    expect(intentNames(first)).toEqual(["recordScenarioRunsThreshold"]);
    const again = scenarioRunsCounted(first.state, counted({ runs: 120 }), ctx(now + 1));
    expect(intentNames(again)).toEqual([]);
  });

  /** @scenario The threshold is recorded during the grace too */
  it("records the threshold with the grace still running", () => {
    const result = scenarioRunsCounted(initialScenarioRunNoticesState, counted(), ctx(now));
    const intent = result.intents?.[0] as { key: string; data: { inGrace: boolean } } | undefined;
    expect(intent?.key).toBe("org-1:2026-11");
    expect(intent?.data.inGrace).toBe(true);
    expect(result.nextWakeAt).toBe(now + 11 * DAY_MS);
  });

  /** @scenario The threshold is recorded again the next month */
  it("records the threshold again in the next month", () => {
    const state: ScenarioRunNoticesState = {
      ...initialScenarioRunNoticesState,
      thresholdMonth: "2026-10",
    };
    expect(intentNames(scenarioRunsCounted(state, counted(), ctx(now)))).toEqual([
      "recordScenarioRunsThreshold",
    ]);
  });

  it("records nothing below the threshold", () => {
    const result = scenarioRunsCounted(
      initialScenarioRunNoticesState,
      counted({ runs: 79 }),
      ctx(now),
    );
    expect(intentNames(result)).toEqual([]);
  });

  it("records nothing and arms no wake without a first run", () => {
    const result = scenarioRunsCounted(
      initialScenarioRunNoticesState,
      counted({ firstRunAt: null, runs: 0 }),
      ctx(now),
    );
    expect(result).toMatchObject({ nextWakeAt: null });
    expect(intentNames(result)).toEqual([]);
  });

  /** @scenario A grace that ended long before the count is closed without a notice */
  it("closes a long-ended grace without its notice", () => {
    const result = scenarioRunsCounted(
      initialScenarioRunNoticesState,
      counted({ runs: 1, firstRunAt: now - 90 * DAY_MS }),
      ctx(now),
    );
    expect(result.state.graceClosed).toBe(true);
    expect(intentNames(result)).toEqual([]);
  });
});

describe("scenarioRunGraceWake", () => {
  /** @scenario The grace ends 14 days after the first run */
  it("records the grace end once", () => {
    const armed = scenarioRunsCounted(
      initialScenarioRunNoticesState,
      counted({ runs: 1, firstRunAt: now - 14 * DAY_MS + 1 }),
      ctx(now),
    );
    const wake = scenarioRunGraceWake(armed.state, ctx(now + 1));
    expect(intentNames(wake)).toEqual(["recordScenarioRunGraceEnded"]);
    expect(intentNames(scenarioRunGraceWake(wake.state, ctx(now + 2)))).toEqual([]);
  });

  it("re-arms while the grace still runs", () => {
    const armed = scenarioRunsCounted(
      initialScenarioRunNoticesState,
      counted({ runs: 1 }),
      ctx(now),
    );
    const wake = scenarioRunGraceWake(armed.state, ctx(now + DAY_MS));
    expect(wake).toMatchObject({ nextWakeAt: now + 11 * DAY_MS });
    expect(intentNames(wake)).toEqual([]);
  });
});
