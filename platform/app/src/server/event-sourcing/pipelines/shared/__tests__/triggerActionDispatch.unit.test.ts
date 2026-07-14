import { TriggerAction } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  CADENCE_WINDOW_MS,
  NOTIFICATION_CADENCES,
} from "~/automations/cadences";
import {
  computeScheduledFor,
  NOTIFY_TRIGGER_ACTIONS,
  PERSIST_TRIGGER_ACTIONS,
} from "../triggerActionDispatch";

describe("trigger action classification", () => {
  describe("when classifying notify actions", () => {
    it("treats email and Slack as notify", () => {
      expect(NOTIFY_TRIGGER_ACTIONS.has(TriggerAction.SEND_EMAIL)).toBe(true);
      expect(NOTIFY_TRIGGER_ACTIONS.has(TriggerAction.SEND_SLACK_MESSAGE)).toBe(
        true,
      );
    });
  });

  describe("when classifying persist actions", () => {
    it("treats dataset and annotation-queue writes as persist", () => {
      expect(PERSIST_TRIGGER_ACTIONS.has(TriggerAction.ADD_TO_DATASET)).toBe(
        true,
      );
      expect(
        PERSIST_TRIGGER_ACTIONS.has(TriggerAction.ADD_TO_ANNOTATION_QUEUE),
      ).toBe(true);
    });
  });

  describe("when combining the two classes", () => {
    const allActions = Object.values(TriggerAction);

    it("covers every trigger action exactly once", () => {
      for (const action of allActions) {
        const inNotify = NOTIFY_TRIGGER_ACTIONS.has(action);
        const inPersist = PERSIST_TRIGGER_ACTIONS.has(action);
        expect(
          inNotify !== inPersist,
          `${action} must be in exactly one class`,
        ).toBe(true);
      }
    });

    it("has no extra members beyond the enum", () => {
      expect(NOTIFY_TRIGGER_ACTIONS.size + PERSIST_TRIGGER_ACTIONS.size).toBe(
        allActions.length,
      );
    });
  });
});

describe("computeScheduledFor", () => {
  const now = new Date("2026-05-29T12:00:00.000Z");

  describe("when the action is a persist action", () => {
    it("schedules immediately regardless of cadence", () => {
      for (const cadence of NOTIFICATION_CADENCES) {
        expect(
          computeScheduledFor({
            action: TriggerAction.ADD_TO_DATASET,
            cadence,
            now,
          }),
        ).toEqual(now);
        expect(
          computeScheduledFor({
            action: TriggerAction.ADD_TO_ANNOTATION_QUEUE,
            cadence,
            now,
          }),
        ).toEqual(now);
      }
    });
  });

  describe("when the action is a notify action on the immediate cadence", () => {
    it("schedules immediately", () => {
      expect(
        computeScheduledFor({
          action: TriggerAction.SEND_SLACK_MESSAGE,
          cadence: "immediate",
          now,
        }),
      ).toEqual(now);
    });
  });

  describe("when the action is a notify action on a digest cadence", () => {
    it("schedules at the end of the digest window", () => {
      expect(
        computeScheduledFor({
          action: TriggerAction.SEND_EMAIL,
          cadence: "5min_digest",
          now,
        }),
      ).toEqual(new Date(now.getTime() + CADENCE_WINDOW_MS["5min_digest"]));

      expect(
        computeScheduledFor({
          action: TriggerAction.SEND_SLACK_MESSAGE,
          cadence: "hourly_digest",
          now,
        }),
      ).toEqual(new Date(now.getTime() + CADENCE_WINDOW_MS.hourly_digest));
    });
  });

  describe("when now falls inside a digest window (off-boundary)", () => {
    it("snaps to the next wall-clock window boundary", () => {
      const offBoundaryNow = new Date("2026-05-29T12:02:17.456Z");
      expect(
        computeScheduledFor({
          action: TriggerAction.SEND_EMAIL,
          cadence: "5min_digest",
          now: offBoundaryNow,
        }),
      ).toEqual(new Date("2026-05-29T12:05:00.000Z"));
    });

    it("produces the same boundary for two different instants in the same window", () => {
      const earlyInWindow = new Date("2026-05-29T12:00:00.001Z");
      const lateInWindow = new Date("2026-05-29T12:04:59.999Z");
      const early = computeScheduledFor({
        action: TriggerAction.SEND_SLACK_MESSAGE,
        cadence: "5min_digest",
        now: earlyInWindow,
      });
      const late = computeScheduledFor({
        action: TriggerAction.SEND_SLACK_MESSAGE,
        cadence: "5min_digest",
        now: lateInWindow,
      });
      expect(early).toEqual(late);
      expect(early).toEqual(new Date("2026-05-29T12:05:00.000Z"));
    });
  });
});
