/**
 * The seat sharing check's schedule: hourly wakes, one check a day, the first at once.
 * Spec: modules/ops/specs/seat-sharing-check.feature
 */
import { intentAccessorOf } from "@langwatch/eventing/testing";
import { describe, expect, it } from "vitest";

import { SEAT_SHARING_PROCESS_NAME } from "../ops-seat-sharing.intent.ts";
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
