import { beforeEach, describe, expect, it } from "vitest";
import { useViewStore } from "../viewStore";

/**
 * `reorderColumns(from, to)` is the move primitive that powers both the
 * move-up/move-down buttons and the DnD handler in `VisibleOrderStrip`.
 * Out-of-range or no-op indices must leave state untouched (the strip
 * wires it up with `columnOrder.indexOf(...)` which returns -1 for
 * unknown ids — a -1 must not delete the head of the order). Successful
 * moves splice-and-reinsert and mark the active lens as a draft.
 */

const seedOrder = (columnOrder: string[]) => {
  useViewStore.setState({ columnOrder });
};

const order = () => useViewStore.getState().columnOrder;

beforeEach(() => {
  useViewStore.setState({ draftState: new Map() });
});

describe("viewStore.reorderColumns", () => {
  describe("given a 4-column order [a, b, c, d]", () => {
    beforeEach(() => seedOrder(["a", "b", "c", "d"]));

    describe("when moving the middle column up by one", () => {
      it("swaps it with its predecessor", () => {
        useViewStore.getState().reorderColumns(2, 1);
        expect(order()).toEqual(["a", "c", "b", "d"]);
      });
    });

    describe("when moving the middle column down by one", () => {
      it("swaps it with its successor", () => {
        useViewStore.getState().reorderColumns(1, 2);
        expect(order()).toEqual(["a", "c", "b", "d"]);
      });
    });

    describe("when moving the first column up", () => {
      it("clamps and leaves the order untouched (from === to)", () => {
        useViewStore.getState().reorderColumns(0, 0);
        expect(order()).toEqual(["a", "b", "c", "d"]);
      });
    });

    describe("when moving the last column down", () => {
      it("clamps and leaves the order untouched (from === to)", () => {
        useViewStore.getState().reorderColumns(3, 3);
        expect(order()).toEqual(["a", "b", "c", "d"]);
      });
    });

    describe("when moving the first column to the last position", () => {
      it("splices it out and reinserts at the end", () => {
        useViewStore.getState().reorderColumns(0, 3);
        expect(order()).toEqual(["b", "c", "d", "a"]);
      });
    });

    describe("when moving the last column to the first position", () => {
      it("splices it out and reinserts at the head", () => {
        useViewStore.getState().reorderColumns(3, 0);
        expect(order()).toEqual(["d", "a", "b", "c"]);
      });
    });

    describe("when called with a negative fromIndex (e.g. indexOf returned -1)", () => {
      it("is a no-op — does not delete the head", () => {
        useViewStore.getState().reorderColumns(-1, 1);
        expect(order()).toEqual(["a", "b", "c", "d"]);
      });
    });

    describe("when called with a negative toIndex", () => {
      it("is a no-op", () => {
        useViewStore.getState().reorderColumns(1, -1);
        expect(order()).toEqual(["a", "b", "c", "d"]);
      });
    });

    describe("when called with an out-of-range fromIndex", () => {
      it("is a no-op", () => {
        useViewStore.getState().reorderColumns(99, 1);
        expect(order()).toEqual(["a", "b", "c", "d"]);
      });
    });

    describe("when called with an out-of-range toIndex", () => {
      it("is a no-op", () => {
        useViewStore.getState().reorderColumns(1, 99);
        expect(order()).toEqual(["a", "b", "c", "d"]);
      });
    });

    describe("when called with the same from and to indices", () => {
      it("is a no-op", () => {
        useViewStore.getState().reorderColumns(2, 2);
        expect(order()).toEqual(["a", "b", "c", "d"]);
      });
    });
  });

  describe("given a 1-column order", () => {
    beforeEach(() => seedOrder(["only"]));

    describe("when attempting any move", () => {
      it("is a no-op for any combination", () => {
        useViewStore.getState().reorderColumns(0, 0);
        useViewStore.getState().reorderColumns(0, 1);
        useViewStore.getState().reorderColumns(1, 0);
        expect(order()).toEqual(["only"]);
      });
    });
  });

  describe("when a successful move runs", () => {
    beforeEach(() => seedOrder(["a", "b", "c"]));

    it("writes the new order into the active lens's draft state", () => {
      useViewStore.getState().reorderColumns(0, 2);
      const { activeLensId, draftState } = useViewStore.getState();
      expect(order()).toEqual(["b", "c", "a"]);
      expect(draftState.get(activeLensId)?.columns).toEqual(["b", "c", "a"]);
    });
  });

  describe("when a no-op move runs (clamped or out-of-range)", () => {
    beforeEach(() => seedOrder(["a", "b", "c"]));

    it("does not write a draft entry", () => {
      useViewStore.getState().reorderColumns(-1, 0);
      const { activeLensId, draftState } = useViewStore.getState();
      expect(draftState.get(activeLensId)?.columns).toBeUndefined();
    });
  });
});
