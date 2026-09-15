/**
 * The composer's ✕ is the one remove affordance for held context, and a chip
 * can be held by more than one source at once.
 * @see specs/langy/langy-context-attach.feature
 */
import { beforeEach, describe, expect, it } from "vitest";
import { traceContextChip } from "../langy-context-chips.ts";
import { removeContextChip, useLangyContextTargetStore } from "../langy-context-target.store.ts";
import { useLangyStore } from "../langy.store.ts";

const TRACE_ID = "abc123def456";
const chip = traceContextChip(TRACE_ID);

beforeEach(() => {
  useLangyStore.getState().resetChosenChips();
  for (const attached of [...useLangyStore.getState().attachedContext]) {
    useLangyStore.getState().detachContext(attached.id);
  }
  useLangyContextTargetStore.getState().clearPicked();
});

describe("removeContextChip", () => {
  describe("given a chip that is both page-derived and explicitly attached", () => {
    /** @scenario Removing a chip clears every source it has */
    it("dismisses the derived chip and detaches the attachment together", () => {
      useLangyStore.getState().chooseChip(chip.id);
      useLangyStore.getState().attachContext({ type: "trace", id: chip.id, label: chip.label });
      expect(useLangyStore.getState().chosenChipIds.has(chip.id)).toBe(true);
      expect(useLangyStore.getState().attachedContext).toHaveLength(1);

      removeContextChip(chip.id);

      // Either source left behind would put the chip straight back in the
      // composer the next time the page rerenders.
      expect(useLangyStore.getState().chosenChipIds.has(chip.id)).toBe(false);
      expect(useLangyStore.getState().attachedContext).toEqual([]);
    });
  });

  describe("given a chip that is only page-derived", () => {
    it("dismisses it without touching the attachment list", () => {
      useLangyStore.getState().chooseChip(chip.id);

      removeContextChip(chip.id);

      expect(useLangyStore.getState().chosenChipIds.has(chip.id)).toBe(false);
      expect(useLangyStore.getState().attachedContext).toEqual([]);
    });
  });
});
