import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type LangyContextTarget,
  useLangyContextTargetStore,
} from "../stores/langyContextTargetStore";

const traceRow: LangyContextTarget = {
  id: "trace:abc123",
  kind: "trace",
  label: "trace abc123",
  ref: "abc123",
};

const evaluationCard: LangyContextTarget = {
  id: "evaluation:mon_1",
  kind: "evaluation",
  label: "evaluation: latency check",
  ref: "mon_1",
};

const store = () => useLangyContextTargetStore.getState();

describe("langyContextTargetStore", () => {
  beforeEach(() => {
    store().reset();
  });

  describe("given a component registering itself as a context target", () => {
    describe("when it mounts", () => {
      it("holds the target keyed by its chip id", () => {
        store().register(traceRow);

        expect(store().targets).toEqual({ "trace:abc123": traceRow });
      });
    });

    describe("when it unmounts", () => {
      it("drops the target", () => {
        store().register(traceRow);
        store().unregister(traceRow.id);

        expect(store().targets).toEqual({});
      });

      it("leaves other mounted targets alone", () => {
        store().register(traceRow);
        store().register(evaluationCard);
        store().unregister(traceRow.id);

        expect(store().targets).toEqual({
          "evaluation:mon_1": evaluationCard,
        });
      });
    });

    describe("when the same id registers twice with identical content", () => {
      it("keeps a single entry and does not churn the state object", () => {
        store().register(traceRow);
        const before = store().targets;

        store().register({ ...traceRow });

        expect(Object.keys(store().targets)).toEqual(["trace:abc123"]);
        // Same object identity: zustand short-circuits, so no subscriber wakes.
        expect(store().targets).toBe(before);
      });
    });

    describe("when the same id registers again with a changed label", () => {
      it("replaces the target with the newer content", () => {
        store().register(traceRow);
        store().register({ ...traceRow, label: "trace abc123 (renamed)" });

        expect(store().targets["trace:abc123"]?.label).toBe(
          "trace abc123 (renamed)",
        );
      });
    });

    describe("when unregistering an id that was never registered", () => {
      it("leaves the registry untouched", () => {
        const before = store().targets;

        store().unregister("trace:never-mounted");

        expect(store().targets).toBe(before);
      });
    });
  });

  describe("given the user clicks targets to add them to Langy", () => {
    describe("when a target is picked", () => {
      it("keeps it in click order", () => {
        store().pick(traceRow);
        store().pick(evaluationCard);

        expect(store().picked.map((t) => t.id)).toEqual([
          "trace:abc123",
          "evaluation:mon_1",
        ]);
      });

      it("keeps a full copy so the pick outlives the target unmounting", () => {
        store().register(traceRow);
        store().pick(traceRow);

        // A virtualized trace row scrolls out of view and unmounts.
        store().unregister(traceRow.id);

        expect(store().targets).toEqual({});
        expect(store().picked).toEqual([traceRow]);
      });
    });

    describe("when the same target is picked twice", () => {
      it("does not duplicate it", () => {
        store().pick(traceRow);
        store().pick({ ...traceRow });

        expect(store().picked).toHaveLength(1);
      });
    });

    describe("when a picked target is unpicked", () => {
      it("removes it and leaves the rest", () => {
        store().pick(traceRow);
        store().pick(evaluationCard);

        store().unpick(traceRow.id);

        expect(store().picked.map((t) => t.id)).toEqual(["evaluation:mon_1"]);
      });
    });

    describe("when unpicking something that was never picked", () => {
      it("leaves the picks untouched", () => {
        store().pick(traceRow);
        const before = store().picked;

        store().unpick("dataset:nope");

        expect(store().picked).toBe(before);
      });
    });
  });

  describe("given the composer publishes the chips it is showing", () => {
    describe("when the chip list changes", () => {
      it("exposes the ids so a target can tell it is already in context", () => {
        store().setActiveChipIds(["trace:abc123", "evaluation:mon_1"]);

        expect(store().activeChipIds.has("trace:abc123")).toBe(true);
        expect(store().activeChipIds.has("dataset:xyz")).toBe(false);
      });
    });

    describe("when the same chip ids are published again", () => {
      it("does not churn the state object", () => {
        store().setActiveChipIds(["trace:abc123", "evaluation:mon_1"]);
        const before = store().activeChipIds;

        store().setActiveChipIds(["evaluation:mon_1", "trace:abc123"]);

        expect(store().activeChipIds).toBe(before);
      });
    });
  });

  describe("given the composer asks to see a kind of thing (#trace)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    describe("when targets of that kind are mounted on the page", () => {
      it("lights them up, and only them", () => {
        store().register(traceRow);
        store().register(evaluationCard);

        store().requestReveal({ kind: "trace" });

        expect(store().revealedIds.has("trace:abc123")).toBe(true);
        expect(store().revealedIds.has("evaluation:mon_1")).toBe(false);
        expect(store().pendingReveal).toBeNull();
      });

      it("lets go after a moment — a look, not a state", () => {
        store().register(traceRow);
        store().requestReveal({ kind: "trace" });

        vi.runAllTimers();

        expect(store().revealedIds.size).toBe(0);
      });

      it("caps how many light up at once", () => {
        for (let i = 0; i < 40; i++) {
          store().register({
            id: `trace:t${i}`,
            kind: "trace",
            label: `trace t${i}`,
            ref: `t${i}`,
          });
        }

        store().requestReveal({ kind: "trace" });

        expect(store().revealedIds.size).toBe(30);
      });
    });

    describe("when nothing of that kind is on the page yet (browse)", () => {
      it("holds the ask instead of lighting nothing", () => {
        store().requestReveal({ kind: "trace" });

        expect(store().revealedIds.size).toBe(0);
        expect(store().pendingReveal?.kind).toBe("trace");
      });

      it("lights matching targets up as they mount on the next page", () => {
        store().requestReveal({ kind: "trace" });

        store().register(traceRow);
        store().register(evaluationCard);

        expect(store().revealedIds.has("trace:abc123")).toBe(true);
        expect(store().revealedIds.has("evaluation:mon_1")).toBe(false);
      });

      it("goes stale rather than glowing a page visited much later", () => {
        store().requestReveal({ kind: "trace" });

        vi.advanceTimersByTime(16_000);
        store().register(traceRow);

        expect(store().revealedIds.size).toBe(0);
        expect(store().pendingReveal).toBeNull();
      });
    });
  });
});
