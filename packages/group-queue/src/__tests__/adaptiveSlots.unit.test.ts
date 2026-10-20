/** How many jobs a consumer runs at once as its load changes. specs/adaptive-slots.feature */
import { describe, expect, it } from "vitest";

import { AdaptiveSlots } from "../adaptiveSlots.ts";

describe("AdaptiveSlots", () => {
  describe("when every slot is taken and the event loop is idle", () => {
    /** @scenario "Slots grow by a quarter while every slot is taken and the event loop is idle" */
    it("grows by a quarter up to the ceiling", () => {
      const changes: number[] = [];
      const slots = new AdaptiveSlots({
        floor: 100,
        ceiling: 150,
        busy: () => 1_000,
        onChange: (next) => changes.push(next),
        readLoad: () => ({ loop: 0.3, heap: 0.4 }),
      });

      slots.adjust();
      slots.adjust();
      slots.adjust();

      expect(changes).toEqual([125, 150]);
      expect(slots.current()).toBe(150);
    });
  });

  describe("when the event loop is near full", () => {
    /** @scenario "A busy event loop gives slots back down to the configured concurrency" */
    it("shrinks by a fifth down to the floor", () => {
      const changes: number[] = [];
      let load = { loop: 0.3, heap: 0.4 };
      const slots = new AdaptiveSlots({
        floor: 100,
        ceiling: 1_000,
        busy: () => 1_000,
        onChange: (next) => changes.push(next),
        readLoad: () => load,
      });
      slots.adjust();
      slots.adjust();
      load = { loop: 0.98, heap: 0.4 };

      slots.adjust();
      slots.adjust();

      expect(changes).toEqual([125, 157, 125, 100]);
      expect(slots.current()).toBe(100);
    });
  });

  describe("when the heap is above four fifths of its limit", () => {
    /** @scenario "A nearly full heap gives slots back down to the configured concurrency" */
    it("shrinks by a fifth down to the floor, though the loop is idle", () => {
      const changes: number[] = [];
      let load = { loop: 0.3, heap: 0.4 };
      const slots = new AdaptiveSlots({
        floor: 100,
        ceiling: 1_000,
        busy: () => 1_000,
        onChange: (next) => changes.push(next),
        readLoad: () => load,
      });
      slots.adjust();
      slots.adjust();
      load = { loop: 0.3, heap: 0.85 };

      slots.adjust();
      slots.adjust();
      slots.adjust();

      expect(changes).toEqual([125, 157, 125, 100]);
      expect(slots.current()).toBe(100);
    });
  });

  describe("when slots sit free", () => {
    /** @scenario "Slots sitting free keep the count" */
    it("keeps the count", () => {
      const changes: number[] = [];
      const slots = new AdaptiveSlots({
        floor: 100,
        ceiling: 1_000,
        busy: () => 10,
        onChange: (next) => changes.push(next),
        readLoad: () => ({ loop: 0.3, heap: 0.4 }),
      });

      slots.adjust();

      expect(changes).toEqual([]);
      expect(slots.current()).toBe(100);
    });
  });

  describe("when the ceiling is the configured concurrency", () => {
    /** @scenario "A ceiling at or below the configured concurrency keeps the count fixed" */
    it("stays at the configured concurrency while saturated and idle", () => {
      const changes: number[] = [];
      const slots = new AdaptiveSlots({
        floor: 100,
        ceiling: 100,
        busy: () => 1_000,
        onChange: (next) => changes.push(next),
        readLoad: () => ({ loop: 0.3, heap: 0.4 }),
      });

      slots.start();
      slots.adjust();
      slots.stop();

      expect(changes).toEqual([]);
      expect(slots.current()).toBe(100);
    });
  });
});
