import { beforeEach, describe, expect, it } from "vitest";
import {
  attachedContextToChip,
  type LangyAttachedContext,
  useLangyStore,
} from "../stores/langyStore";

/**
 * The surface-driven context-attach API (task #21a): the clean, typed entry
 * point any surface (a home card, a briefing receipt) uses to hand Langy a piece
 * of context. This guards the store contract briefing wires against.
 */

const traceItem: LangyAttachedContext = {
  type: "trace",
  id: "trace-abc",
  label: "Checkout agent — slow run",
};

describe("attachContext", () => {
  beforeEach(() => {
    // Each test starts as a fresh page load into the project: without
    // clearing `scopeAnnounced` (never persisted — false on a real load),
    // a repeated same-project reset is a deliberate heartbeat no-op and
    // state would bleed between tests.
    useLangyStore.setState({ scopeAnnounced: false });
    useLangyStore.getState().resetForProject("project-test");
  });

  describe("given a surface attaches a piece of context", () => {
    it("lists exactly that item", () => {
      useLangyStore.getState().attachContext(traceItem);
      expect(useLangyStore.getState().attachedContext).toEqual([traceItem]);
    });
  });

  describe("when the same id is attached again", () => {
    it("refreshes it in place rather than stacking a duplicate", () => {
      useLangyStore.getState().attachContext(traceItem);
      useLangyStore
        .getState()
        .attachContext({ ...traceItem, label: "Checkout agent — 8.2s" });

      const list = useLangyStore.getState().attachedContext;
      expect(list).toHaveLength(1);
      expect(list[0]!.label).toBe("Checkout agent — 8.2s");
    });
  });

  describe("when one of several items is detached", () => {
    it("removes only the named item", () => {
      useLangyStore.getState().attachContext(traceItem);
      useLangyStore
        .getState()
        .attachContext({ type: "dataset", id: "ds-1", label: "Golden set" });

      useLangyStore.getState().detachContext("trace-abc");

      const list = useLangyStore.getState().attachedContext;
      expect(list).toHaveLength(1);
      expect(list[0]!.id).toBe("ds-1");
    });
  });

  describe("when the store resets for a new project", () => {
    it("clears attached context so it cannot bleed across projects", () => {
      useLangyStore.getState().attachContext(traceItem);
      // A genuinely different project — a same-project re-announcement is a
      // heartbeat and deliberately keeps the user's grabbed context.
      useLangyStore.getState().resetForProject("project-other");
      expect(useLangyStore.getState().attachedContext).toEqual([]);
    });
  });

  describe("when the same project is re-announced mid-conversation", () => {
    it("keeps the attached context — a heartbeat is not a move", () => {
      useLangyStore.getState().attachContext(traceItem);
      useLangyStore.getState().resetForProject("project-test");
      expect(useLangyStore.getState().attachedContext).toEqual([traceItem]);
    });
  });

  describe("clearAttachedContext", () => {
    it("empties the list", () => {
      useLangyStore.getState().attachContext(traceItem);
      useLangyStore.getState().clearAttachedContext();
      expect(useLangyStore.getState().attachedContext).toEqual([]);
    });
  });
});

describe("attachedContextToChip", () => {
  it("adapts an attached item into the chip shape the agent + sidebar speak", () => {
    const chip = attachedContextToChip(traceItem);
    // The id namespaces on kind + ref so an attached trace and a route-derived
    // one for the same trace collapse into one chip instead of stacking.
    expect(chip).toEqual({
      id: "trace:trace-abc",
      kind: "trace",
      label: "Checkout agent — slow run",
      ref: "trace-abc",
    });
  });
});
