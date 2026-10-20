import { describe, expect, it } from "vitest";

import { AdaptiveSlots } from "../adaptiveSlots.ts";

describe("AdaptiveSlots", () => {
  describe("when every slot is taken and the event loop is idle", () => {
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

  describe("when slots sit free", () => {
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
});
