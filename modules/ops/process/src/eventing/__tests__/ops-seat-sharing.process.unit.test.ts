/**
 * The seat sharing check's schedule: hourly wakes, one check a day, the first at once.
 * Spec: modules/ops/specs/seat-sharing-check.feature
 */
import { intentAccessorOf } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";

import { runSeatSharingCheck, SEAT_SHARING_PROCESS_NAME } from "../ops-seat-sharing.intent.ts";
import { buildOpsSeatSharingPipeline } from "../ops-seat-sharing.pipeline.ts";
import { seatSharingWake, type SeatSharingScheduleState } from "../ops-seat-sharing.process.ts";

const at = (iso: string) => Date.parse(iso);

function wake(state: SeatSharingScheduleState, iso: string) {
  const moment = at(iso);
  return seatSharingWake(state, {
    at: moment,
    now: moment,
    key: SEAT_SHARING_PROCESS_NAME,
    projectId: "__global__",
    intent: intentAccessorOf({
      check: (messageKey, payload) => ({ messageKey, intentType: "check", payload }),
    }),
  });
}

describe("the seat sharing schedule", () => {
  /** @scenario "The check runs once a day and its first wake runs at once" */
  it("checks on the first wake, then once a day has passed, keyed by the day", () => {
    const first = wake({ lastCheckedAt: null }, "2026-11-06T09:00:00Z");
    expect(first.intents).toHaveLength(1);
    expect(first.state).toEqual({ lastCheckedAt: at("2026-11-06T09:00:00Z") });

    expect(wake(first.state, "2026-11-06T22:00:00Z").intents).toBeUndefined();
    expect(wake(first.state, "2026-11-07T08:59:00Z").intents).toBeUndefined();

    const next = wake(first.state, "2026-11-07T09:00:00Z");
    expect(next.intents).toHaveLength(1);
    expect(next.intents?.[0]?.messageKey).not.toBe(first.intents?.[0]?.messageKey);
  });
});

describe("the seat sharing tick", () => {
  const now = at("2026-11-06T09:00:00Z");
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  /** @scenario "A failed check waits for the next day and the outbox is still pruned" */
  it("runs the check and prunes its week-old bookkeeping", async () => {
    const check = vi.fn(async () => {});
    const deleteDispatchedBefore = vi.fn(async () => 0);

    await runSeatSharingCheck({ check, deleteDispatchedBefore, now: () => now })();

    expect(check).toHaveBeenCalledTimes(1);
    expect(deleteDispatchedBefore).toHaveBeenCalledWith({
      processName: SEAT_SHARING_PROCESS_NAME,
      before: weekAgo,
    });
  });

  /** @scenario "A failed check waits for the next day and the outbox is still pruned" */
  it("swallows a failed check and still prunes", async () => {
    const deleteDispatchedBefore = vi.fn(async () => 0);

    await expect(
      runSeatSharingCheck({
        check: () => Promise.reject(new Error("redis down")),
        deleteDispatchedBefore,
        now: () => now,
      })(),
    ).resolves.toBeUndefined();

    expect(deleteDispatchedBefore).toHaveBeenCalledWith({
      processName: SEAT_SHARING_PROCESS_NAME,
      before: weekAgo,
    });
  });

  /** @scenario "The check runs once a day and its first wake runs at once" */
  it("builds a pipeline that wakes the check process hourly", () => {
    const pipeline = buildOpsSeatSharingPipeline({
      check: async () => {},
      deleteDispatchedBefore: async () => 0,
      now: () => 0,
    });

    expect(pipeline.processManagers.get(SEAT_SHARING_PROCESS_NAME)?.config.schedule).toEqual({
      everyMs: 60 * 60 * 1000,
    });
  });
});
