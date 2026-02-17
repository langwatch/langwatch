import { describe, it, expect } from "vitest";
import { ScenarioRunStatus } from "../scenario-event.enums";
import {
  resolveRunStatus,
  STALL_THRESHOLD_MS,
} from "../stall-detection";

const NOW = Date.now();

function minutesAgo(minutes: number): number {
  return NOW - minutes * 60 * 1000;
}

describe("resolveRunStatus()", () => {
  describe("given a run without RUN_FINISHED", () => {
    describe("when the last event is within the threshold", () => {
      it("returns IN_PROGRESS", () => {
        const status = resolveRunStatus({
          finishedStatus: undefined,
          lastEventTimestamp: minutesAgo(3),
          now: NOW,
        });

        expect(status).toBe(ScenarioRunStatus.IN_PROGRESS);
      });
    });

    describe("when the last event is beyond the threshold", () => {
      it("returns STALLED", () => {
        const status = resolveRunStatus({
          finishedStatus: undefined,
          lastEventTimestamp: minutesAgo(15),
          now: NOW,
        });

        expect(status).toBe(ScenarioRunStatus.STALLED);
      });
    });

    describe("when the last event is at exactly the threshold boundary", () => {
      it("returns STALLED", () => {
        const status = resolveRunStatus({
          finishedStatus: undefined,
          lastEventTimestamp: NOW - STALL_THRESHOLD_MS,
          now: NOW,
        });

        expect(status).toBe(ScenarioRunStatus.STALLED);
      });
    });
  });

  describe("given a run with RUN_FINISHED", () => {
    describe("when the finished status is SUCCESS", () => {
      it("returns SUCCESS regardless of age", () => {
        const status = resolveRunStatus({
          finishedStatus: ScenarioRunStatus.SUCCESS,
          lastEventTimestamp: minutesAgo(30),
          now: NOW,
        });

        expect(status).toBe(ScenarioRunStatus.SUCCESS);
      });
    });

    describe("when the finished status is ERROR", () => {
      it("returns ERROR regardless of age", () => {
        const status = resolveRunStatus({
          finishedStatus: ScenarioRunStatus.ERROR,
          lastEventTimestamp: minutesAgo(20),
          now: NOW,
        });

        expect(status).toBe(ScenarioRunStatus.ERROR);
      });
    });

    describe("when the finished status is FAILED", () => {
      it("returns FAILED", () => {
        const status = resolveRunStatus({
          finishedStatus: ScenarioRunStatus.FAILED,
          lastEventTimestamp: minutesAgo(20),
          now: NOW,
        });

        expect(status).toBe(ScenarioRunStatus.FAILED);
      });
    });

    describe("when the finished status is CANCELLED", () => {
      it("returns CANCELLED", () => {
        const status = resolveRunStatus({
          finishedStatus: ScenarioRunStatus.CANCELLED,
          lastEventTimestamp: minutesAgo(20),
          now: NOW,
        });

        expect(status).toBe(ScenarioRunStatus.CANCELLED);
      });
    });
  });

  describe("given stall detection uses the last event timestamp", () => {
    describe("when a MESSAGE_SNAPSHOT event is recent but RUN_STARTED is old", () => {
      it("returns IN_PROGRESS based on the more recent event", () => {
        // RUN_STARTED was 20 minutes ago, but a MESSAGE_SNAPSHOT was 3 minutes ago
        // The lastEventTimestamp should be the MESSAGE_SNAPSHOT timestamp
        const status = resolveRunStatus({
          finishedStatus: undefined,
          lastEventTimestamp: minutesAgo(3),
          now: NOW,
        });

        expect(status).toBe(ScenarioRunStatus.IN_PROGRESS);
      });
    });
  });
});
