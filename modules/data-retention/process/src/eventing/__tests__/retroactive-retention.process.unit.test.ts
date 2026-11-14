import type { RetroactiveMutationRecord } from "@langwatch/data-retention-contract";
import { describe, expect, it } from "vitest";

import {
  RETROACTIVE_PROGRESS_INTERVAL_MS,
  RETROACTIVE_RETENTION_INITIAL_STATE,
  retroactiveProgressRecorded,
  retroactiveProgressWake,
} from "../retroactive-retention.process.ts";

const PROJECT = "project-1";
const AT = 1_800_000_000_000;

function context(at: number) {
  return {
    at,
    now: at,
    key: PROJECT,
    projectId: PROJECT,
    intent: (name: string, key: string, payload: unknown) => ({
      messageKey: key,
      intentType: name,
      payload: payload as never,
    }),
  };
}

const running: RetroactiveMutationRecord = {
  mutationId: "mutation_1",
  table: "stored_spans",
  isDone: false,
  partsToDo: 3,
  partsTotal: 4,
  createTime: "2027-01-15T08:00:00",
  category: "traces",
};

describe("the retroactive retention process", () => {
  /** @scenario "Each project's process wakes itself while its rewrites run and stops when they settle" */
  it("wakes the project while its rewrites run and stops once none do", () => {
    const armed = retroactiveProgressRecorded(
      RETROACTIVE_RETENTION_INITIAL_STATE,
      { projectId: PROJECT, mutations: [running], settled: null },
      context(AT),
    );
    expect(armed.nextWakeAt).toBe(AT + RETROACTIVE_PROGRESS_INTERVAL_MS);

    const wakeAt = AT + RETROACTIVE_PROGRESS_INTERVAL_MS;
    const woken = retroactiveProgressWake(armed.state, context(wakeAt));
    expect(woken.intents).toEqual([
      {
        messageKey: `progress:${wakeAt}`,
        intentType: "refreshProgress",
        payload: { projectId: PROJECT, scheduledFor: wakeAt },
      },
    ]);
    expect(woken.nextWakeAt).toBe(wakeAt + RETROACTIVE_PROGRESS_INTERVAL_MS);

    const settled = retroactiveProgressRecorded(
      woken.state,
      { projectId: PROJECT, mutations: [], settled: null },
      context(wakeAt + 1),
    );
    expect(settled.nextWakeAt).toBeNull();
    const stale = retroactiveProgressWake(settled.state, context(wakeAt + 2));
    expect(stale.nextWakeAt).toBeNull();
    expect(stale.intents ?? []).toEqual([]);
  });
});
