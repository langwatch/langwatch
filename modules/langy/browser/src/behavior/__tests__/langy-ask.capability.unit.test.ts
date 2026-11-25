import { beforeEach, describe, expect, it } from "vitest";

import { createLangyAsk, langyAsk } from "../langy-ask.capability.ts";
/**
 * The ask capability: what another module's question becomes on the panel,
 * proven against the store it writes.
 */
import { useLangyPageContextStore } from "../langy-page-context.store.ts";
import { useLangyStore } from "../langy.store.ts";

const view = {
  kind: "filter" as const,
  ref: "data source: traces; time range: Last 30 days",
  label: "Traces · Last 30 days",
};

beforeEach(() => {
  useLangyStore.setState({
    isOpen: false,
    draft: "",
    pendingPrompt: null,
    attachedContext: [],
    composerFocusRequested: false,
    chosenChipIds: new Set(),
    dismissedChipIds: new Set(),
  });
  useLangyPageContextStore.setState({ pageContext: [] });
});

describe("given another module asking Langy a question", () => {
  describe("when the question is typed", () => {
    it("asks it outright, with the view attached to the conversation it starts", () => {
      langyAsk.ask({ question: "  why are these failing?  ", context: [view] });

      const state = useLangyStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.pendingPrompt).toBe("why are these failing?");
      expect(state.attachedContext).toEqual([{ type: "filter", id: view.ref, label: view.label }]);
    });
  });

  describe("when nothing was typed", () => {
    it("opens the composer with the sentence started", () => {
      langyAsk.ask({ draft: "Find traces where ", context: [view] });

      expect(useLangyStore.getState().isOpen).toBe(true);
      expect(useLangyStore.getState().draft).toBe("Find traces where ");
    });

    it("opens the panel with the cursor in the composer when nothing is asked", () => {
      langyAsk.ask({ context: [view] });

      expect(useLangyStore.getState().isOpen).toBe(true);
      expect(useLangyStore.getState().composerFocusRequested).toBe(true);
      expect(useLangyStore.getState().pendingPrompt).toBeFalsy();
    });

    it("never plants the seed over a half-written question", () => {
      useLangyStore.setState({ draft: "why is checkout " });

      langyAsk.ask({ draft: "Find traces where " });

      expect(useLangyStore.getState().draft).toBe("why is checkout ");
    });
  });
});

describe("given a dashboard draft about one board", () => {
  const about = { ref: "board-a" };
  const report = "Write a short report on my board";

  describe("when the draft lands before its board is on screen", () => {
    /** @scenario "Langy drafts: a draft waits until its board is on screen" */
    it("keeps it while the old page is still up, and drops it only after its board has shown", () => {
      const ask = createLangyAsk();
      ask.onScreen({ ref: "templates" });

      ask.ask({ draft: report, about });
      ask.onScreen(null);
      expect(useLangyStore.getState().draft).toBe(report);

      ask.onScreen(about);
      ask.onScreen({ ref: "board-b" });
      expect(useLangyStore.getState().draft).toBe("");
    });

    /** @scenario "Langy drafts: an unsent draft is dropped when the member moves to another board" */
    it("takes the board's context chip with the draft", () => {
      const ask = createLangyAsk();
      ask.onScreen(about);
      ask.ask({
        draft: report,
        about,
        context: [{ kind: "dashboard", ref: "board-a", label: "A" }],
      });
      expect(useLangyStore.getState().attachedContext).toHaveLength(1);

      ask.onScreen({ ref: "board-b" });

      expect(useLangyStore.getState().attachedContext).toEqual([]);
    });
  });

  describe("when the member typed into the draft before leaving the board", () => {
    /** @scenario "Langy drafts: text the member typed is never dropped" */
    it("keeps what they typed", () => {
      const ask = createLangyAsk();
      ask.onScreen(about);
      ask.ask({ draft: report, about });
      useLangyStore.getState().setDraft(`${report} for last week`);

      ask.onScreen({ ref: "board-b" });

      expect(useLangyStore.getState().draft).toBe(`${report} for last week`);
    });
  });

  describe("when a second draft follows an untouched one", () => {
    it("replaces it, since the first was never the reader's", () => {
      const ask = createLangyAsk();
      ask.onScreen(about);
      ask.ask({ draft: report, about });

      ask.ask({ draft: "Explain this widget", about });

      expect(useLangyStore.getState().draft).toBe("Explain this widget");
    });
  });
});

describe("given the page offers the board an ask is about", () => {
  const boardRef = 'dashboard "My dashboard" (id board-1); widgets: none yet; period: last 30 days';
  const chip = {
    id: "dashboard:board-1",
    kind: "dashboard" as const,
    label: "dashboard: My dashboard · 30d · 1d",
    ref: boardRef,
  };

  /** @scenario "AC126b Langy context: the open board is listed once, and a widget says what Langy reads" */
  it("chooses the page's chip for it instead of attaching the board a second time", () => {
    useLangyPageContextStore.setState({ pageContext: [chip] });

    langyAsk.ask({
      draft: "What stands out?",
      context: [
        { kind: "dashboard", ref: boardRef, label: "My dashboard" },
        { kind: "dashboard", ref: 'widget "Traffic"', label: "widget: Traffic" },
      ],
    });

    const state = useLangyStore.getState();
    expect(state.chosenChipIds.has(chip.id)).toBe(true);
    expect(state.attachedContext).toEqual([
      { type: "dashboard", id: 'widget "Traffic"', label: "widget: Traffic" },
    ]);
  });
});

describe("given a widget added from the picker, then a value clicked on its card", () => {
  const before = 'dashboard "My dashboard" (id board-1); widgets: none yet';
  const after = 'dashboard "My dashboard" (id board-1); widgets: Which models does my agent use?';
  const chip = {
    id: "dashboard:board-1",
    kind: "dashboard" as const,
    label: "dashboard: My dashboard · 30d · 1d",
    ref: after,
  };
  const board = (ref: string) => ({
    kind: "dashboard" as const,
    ref,
    label: "My dashboard",
    key: "dashboard:board-1",
  });
  const widget = (ref: string) => ({
    kind: "dashboard" as const,
    ref,
    label: "widget: Which models does my agent use?",
    key: "widget:Which models does my agent use?",
  });

  function addThenClick() {
    const ask = createLangyAsk();
    ask.onScreen({ ref: "board-1" });
    // The picker asks with the board as it read before the widget landed on it.
    ask.ask({
      draft: "What does it show?",
      about: { ref: "board-1" },
      context: [board(before), widget('widget "Which models does my agent use?"')],
    });
    useLangyPageContextStore.setState({ pageContext: [chip] });
    ask.ask({
      draft: "What stands out about gpt-5?",
      about: { ref: "board-1" },
      context: [board(after), widget('widget "Which models"; clicked: model "gpt-5"')],
    });
  }

  /** @scenario "AC126c Langy context: a board and a widget asked about again are still listed once" */
  it("lists the board once, as the page's chip, and the widget once, as the latest ask read it", () => {
    addThenClick();

    const state = useLangyStore.getState();
    expect(state.chosenChipIds.has(chip.id)).toBe(true);
    expect(state.attachedContext).toEqual([
      {
        type: "dashboard",
        id: 'widget "Which models"; clicked: model "gpt-5"',
        label: "widget: Which models does my agent use?",
        key: "widget:Which models does my agent use?",
      },
    ]);
  });

  /** @scenario "AC126c Langy context: a board and a widget asked about again are still listed once" */
  it("lets a new chat start on nothing the asks attached", () => {
    addThenClick();

    useLangyStore.getState().startNewConversation();

    const state = useLangyStore.getState();
    expect(state.attachedContext).toEqual([]);
    expect(state.chosenChipIds.size).toBe(0);
  });
});

describe("given an unsent draft that chose the page's board chip", () => {
  const chip = {
    id: "dashboard:board-1",
    kind: "dashboard" as const,
    label: "dashboard: My dashboard · 30d · 1d",
    ref: 'dashboard "My dashboard" (id board-1)',
  };
  const askAboutBoard = () => {
    const ask = createLangyAsk();
    ask.onScreen({ ref: "board-1" });
    ask.ask({
      draft: "What stands out?",
      about: { ref: "board-1" },
      context: [{ kind: "dashboard", ref: chip.ref, label: "My dashboard", key: chip.id }],
    });
    return ask;
  };

  /** @scenario "Langy drafts: an unsent draft is dropped when the member moves to another board" */
  it("takes the chip off with the draft when the member moves to another board", () => {
    useLangyPageContextStore.setState({ pageContext: [chip] });
    const ask = askAboutBoard();
    expect(useLangyStore.getState().chosenChipIds.has(chip.id)).toBe(true);

    ask.onScreen({ ref: "board-2" });

    expect(useLangyStore.getState().chosenChipIds.has(chip.id)).toBe(false);
    expect(useLangyStore.getState().dismissedChipIds.has(chip.id)).toBe(false);
  });

  /** @scenario "Langy drafts: an unsent draft is dropped when the member moves to another board" */
  it("keeps a chip the member had chosen before the ask", () => {
    useLangyPageContextStore.setState({ pageContext: [chip] });
    useLangyStore.getState().chooseChip(chip.id);
    const ask = askAboutBoard();

    ask.onScreen({ ref: "board-2" });

    expect(useLangyStore.getState().chosenChipIds.has(chip.id)).toBe(true);
  });
});

describe("given context attached under one id and another key", () => {
  /** @scenario "AC126c Langy context: a board and a widget asked about again are still listed once" */
  it("lists an entry matching both once, where the first of them stood", () => {
    const langy = useLangyStore.getState();
    langy.attachContext({ type: "dashboard", id: "a", label: "A" });
    langy.attachContext({ type: "dashboard", id: "b", label: "B", key: "k" });
    langy.attachContext({ type: "dashboard", id: "c", label: "C" });

    langy.attachContext({ type: "dashboard", id: "a", label: "A2", key: "k" });

    expect(useLangyStore.getState().attachedContext).toEqual([
      { type: "dashboard", id: "a", label: "A2", key: "k" },
      { type: "dashboard", id: "c", label: "C" },
    ]);
  });
});
