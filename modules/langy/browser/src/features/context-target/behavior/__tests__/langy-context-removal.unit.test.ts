/**
 * The composer's ✕ is the one remove affordance for held context, and a chip
 * can be held by more than one source at once.
 * @see specs/langy/langy-context-attach.feature
 * @see modules/dashboard/specs/dashboards-v2.feature
 */
import { beforeEach, describe, expect, it } from "vitest";

import { createLangyAsk } from "../../../../behavior/langy-ask.capability.ts";
import { useLangyPageContextStore } from "../../../../behavior/langy-page-context.store.ts";
import { attachedContextToChip, useLangyStore } from "../../../../behavior/langy.store.ts";
import { traceContextChip } from "../langy-context-chips.ts";
import { removeContextChip, useLangyContextTargetStore } from "../langy-context-target.store.ts";

const TRACE_ID = "abc123def456";
const chip = traceContextChip(TRACE_ID);

beforeEach(() => {
  useLangyStore.getState().resetChosenChips();
  for (const attached of useLangyStore.getState().attachedContext) {
    useLangyStore.getState().detachContext(attached.id);
  }
  useLangyContextTargetStore.getState().clearPicked();
  useLangyStore.setState({ draft: "" });
  useLangyPageContextStore.setState({ pageContext: [] });
});

describe("removeContextChip", () => {
  describe("given a chip that is both page-derived and explicitly attached", () => {
    /** @scenario Removing a chip clears every source it has */
    it("dismisses the derived chip and detaches the attachment together", () => {
      useLangyStore.getState().chooseChip(chip.id);
      useLangyStore.getState().attachContext({ type: "trace", id: TRACE_ID, label: chip.label });
      // The composer names the attachment by the chip id it shares with the page's chip.
      expect(attachedContextToChip(useLangyStore.getState().attachedContext[0]!).id).toBe(chip.id);
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
    /** @scenario "A context chip can be removed" */
    it("dismisses it without touching the attachment list", () => {
      useLangyStore.getState().chooseChip(chip.id);

      removeContextChip(chip.id);

      expect(useLangyStore.getState().chosenChipIds.has(chip.id)).toBe(false);
      expect(useLangyStore.getState().attachedContext).toEqual([]);
    });
  });
});

describe("given Ask Langy on two dashboard charts", () => {
  const widget = (name: string) => ({
    kind: "dashboard" as const,
    ref: `widget "${name}"; queries: ...`,
    label: `widget: ${name}`,
    key: `dashboard:board-1:widget:${name}`,
  });
  const askAbout = (ask: ReturnType<typeof createLangyAsk>, name: string) =>
    ask.ask({
      draft: `What does "${name}" show?`,
      about: { ref: "board-1" },
      context: [widget(name)],
    });
  const chipLabels = () => useLangyStore.getState().attachedContext.map(({ label }) => label);
  let ask: ReturnType<typeof createLangyAsk>;

  beforeEach(() => {
    ask = createLangyAsk();
    ask.onScreen({ ref: "board-1" });
    askAbout(ask, "Traffic");
  });

  /** @scenario "AC121g Ask Langy: each chart asked about is one entry the member can remove" */
  it("lists both widgets, and the ✕ on one takes only that one out", () => {
    askAbout(ask, "Top errors");
    expect(chipLabels()).toEqual(["widget: Traffic", "widget: Top errors"]);

    const traffic = useLangyStore.getState().attachedContext[0]!;
    removeContextChip(attachedContextToChip(traffic).id);

    // The composer's chips and the next message's context are both read from this list.
    expect(chipLabels()).toEqual(["widget: Top errors"]);
  });

  /** @scenario "AC121g Ask Langy: each chart asked about is one entry the member can remove" */
  it("lists a chart asked about twice once", () => {
    askAbout(ask, "Traffic");

    expect(chipLabels()).toEqual(["widget: Traffic"]);
  });
});
