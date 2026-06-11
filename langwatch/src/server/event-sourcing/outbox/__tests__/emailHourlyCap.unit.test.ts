import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetMemoryEmailCapStore,
  consumeEmailCapSlot,
} from "../emailHourlyCap";

// Redis `connection` is undefined under vitest (BUILD_TIME set in
// vitest.config.ts), so these exercise the in-memory fallback path.

const PROJECT_ID = "proj-1";
const TRIGGER_ID = "trig-1";

describe("consumeEmailCapSlot in-memory fallback", () => {
  beforeEach(() => {
    _resetMemoryEmailCapStore();
  });

  describe("given a fresh hour bucket", () => {
    describe("when dispatches arrive under the cap", () => {
      it("allows them and counts up monotonically", async () => {
        const now = new Date("2026-06-11T10:15:00Z");
        const first = await consumeEmailCapSlot({
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
          now,
          cap: 3,
        });
        const second = await consumeEmailCapSlot({
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
          now,
          cap: 3,
        });

        expect(first).toEqual({ allowed: true, count: 1 });
        expect(second).toEqual({ allowed: true, count: 2 });
      });
    });

    describe("when a dispatch pushes the count past the cap", () => {
      it("reports the slot as not allowed", async () => {
        const now = new Date("2026-06-11T10:15:00Z");
        for (let i = 0; i < 2; i++) {
          await consumeEmailCapSlot({
            projectId: PROJECT_ID,
            triggerId: TRIGGER_ID,
            now,
            cap: 2,
          });
        }
        const overCap = await consumeEmailCapSlot({
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
          now,
          cap: 2,
        });

        expect(overCap).toEqual({ allowed: false, count: 3 });
      });
    });
  });

  describe("given the cap was exhausted in the previous hour", () => {
    describe("when a dispatch arrives in the next hour bucket", () => {
      it("starts a fresh count and allows it again", async () => {
        const firstHour = new Date("2026-06-11T10:59:00Z");
        await consumeEmailCapSlot({
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
          now: firstHour,
          cap: 1,
        });
        const overCapSameHour = await consumeEmailCapSlot({
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
          now: firstHour,
          cap: 1,
        });
        expect(overCapSameHour.allowed).toBe(false);

        const nextHour = new Date("2026-06-11T11:00:00Z");
        const rolledOver = await consumeEmailCapSlot({
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
          now: nextHour,
          cap: 1,
        });

        expect(rolledOver).toEqual({ allowed: true, count: 1 });
      });
    });
  });

  describe("given two distinct triggers in the same project", () => {
    describe("when each dispatches in the same hour", () => {
      it("counts them independently", async () => {
        const now = new Date("2026-06-11T10:15:00Z");
        const a = await consumeEmailCapSlot({
          projectId: PROJECT_ID,
          triggerId: "trig-a",
          now,
          cap: 1,
        });
        const b = await consumeEmailCapSlot({
          projectId: PROJECT_ID,
          triggerId: "trig-b",
          now,
          cap: 1,
        });

        expect(a).toEqual({ allowed: true, count: 1 });
        expect(b).toEqual({ allowed: true, count: 1 });
      });
    });
  });
});
