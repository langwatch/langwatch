/**
 * What a board hands Langy, as text the agent reads: the open board, the
 * widgets on it and the period it reads over.
 * @see modules/dashboard/specs/dashboards-v1.feature
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  askAboutStoredBoard,
  BOARD_QUESTION_ANSWER,
  boardContextChip,
  boardPromptDraft,
  boardQuestion,
  boardSetupDraft,
  boardSubject,
  offersBoardSetup,
  widgetChartDraft,
  widgetPromptDraft,
} from "../model/board-langy.ts";

const PERIOD = {
  periodStart: Temporal.Instant.from("2026-09-01T00:00:00Z").epochMilliseconds,
  periodEnd: Temporal.Instant.from("2026-09-08T00:00:00Z").epochMilliseconds,
  granularitySeconds: 86_400 as const,
};

describe("the context a board hands Langy", () => {
  describe("given a question asked on a board made from the Agent Flight Deck template", () => {
    /** @scenario "AC16 Ask Langy from the board" */
    it("trims the question and names the open board, its widgets and its period", () => {
      const request = boardQuestion({
        question: "  Why did errors spike?  ",
        board: boardSubject({
          board: { id: "board-9", name: "Agent Flight Deck 2" },
          widgets: [{ name: "Status" }, { name: "Most impactful traces" }],
        }),
        period: PERIOD,
      });

      expect(request.question).toBe("Why did errors spike?");
      const [board] = request.context;
      expect(board?.label).toBe("Agent Flight Deck 2");
      expect(board?.ref).toContain('dashboard "Agent Flight Deck 2" (id board-9)');
      expect(board?.ref).toContain("widgets: Status, Most impactful traces");
      expect(board?.ref).toContain("2026-09-01T00:00:00Z to 2026-09-08T00:00:00Z");
    });
  });

  describe("given a board with nothing on it yet", () => {
    /** @scenario "AC16 Ask Langy from the board" */
    it("says it has no widgets yet", () => {
      const request = boardQuestion({
        question: "What should I add?",
        board: boardSubject({ board: { id: "board-1", name: "My dashboard" }, widgets: [] }),
        period: PERIOD,
      });

      expect(request.context[0]?.ref).toContain("widgets: none yet");
    });
  });
});

describe("a question from a board's ask bar", () => {
  const ask = (board: { id: string; name: string; templateId?: string }) =>
    boardQuestion({
      question: "Is our AI saving us time?",
      board: boardSubject({ board, widgets: [] }),
      period: PERIOD,
    });

  /** @scenario "AC264b Langy widgets: a question from a board's ask bar asks for a widget on that board" */
  it("asks for the answer as a widget on the board, then a sentence", () => {
    const [board] = ask({ id: "board-9", name: "Agent impact" }).context;

    expect(board?.ref).toContain(BOARD_QUESTION_ANSWER);
    expect(board?.ref).toContain('dashboard "Agent impact" (id board-9)');
    expect(board?.label).toBe("Agent impact");
  });

  /** @scenario "AC264b Langy widgets: a question from a board's ask bar asks for a widget on that board" */
  it("asks for no widget on a read-only From LangWatch board", () => {
    const [board] = ask({
      id: "curated/release",
      name: "Release check",
      templateId: "release",
    }).context;

    expect(board?.ref).not.toContain(BOARD_QUESTION_ANSWER);
  });
});

describe("a draft about a board", () => {
  describe("given a template's report drafted for a new board", () => {
    /** @scenario "Langy drafts: a draft records the board it is about" */
    it("records the board it is about, so Langy can drop it once the board leaves", () => {
      const request = boardPromptDraft({
        prompt: "Write a short report.",
        board: boardSubject({ board: { id: "board-7", name: "Release check" }, widgets: [] }),
        period: PERIOD,
      });

      expect(request.about).toEqual({ ref: "board-7" });
      expect(request.question).toBeUndefined();
    });
  });

  describe("given a From LangWatch board", () => {
    /** @scenario "From LangWatch: the ask bar asks Langy for a member who may not create dashboards" */
    it("names it as a read-only template rather than a stored board", () => {
      const request = boardQuestion({
        question: "Can it ship?",
        board: boardSubject({
          board: { id: "curated/release", name: "Release check", templateId: "release" },
          widgets: [{ name: "Can the new version of my agent ship?" }],
        }),
        period: PERIOD,
      });

      expect(request.context[0]?.ref).toContain(
        'From LangWatch dashboard "Release check" (template release, read-only, not stored)',
      );
    });
  });
});

describe("the chip a board shows in Langy", () => {
  describe("given a board read over the last 30 days at one bucket per day", () => {
    /** @scenario "The board chip carries the period the user is viewing" */
    it("reads the board's name and the period, and hands over its id, period and grain", () => {
      const chip = boardContextChip({
        board: boardSubject({ board: { id: "board-9", name: "Costs" }, widgets: [] }),
        range: "30d",
        period: PERIOD,
      });

      expect(chip.id).toBe("dashboard:board-9");
      expect(chip.kind).toBe("dashboard");
      expect(chip.label).toBe("dashboard: Costs · 30d · 1d");
      expect(chip.ref).toContain('dashboard "Costs" (id board-9)');
      expect(chip.ref).toContain("2026-09-01T00:00:00Z to 2026-09-08T00:00:00Z");
      expect(chip.ref).toContain("one bucket per 1 day");
    });
  });

  describe("given the live range", () => {
    it("reads Live and the minute grain", () => {
      const chip = boardContextChip({
        board: boardSubject({ board: { id: "board-9", name: "Costs" }, widgets: [] }),
        range: "live",
        period: { ...PERIOD, granularitySeconds: 60 },
      });

      expect(chip.label).toBe("dashboard: Costs · Live · 1m");
    });
  });
});

describe("a board whose widgets show no data", () => {
  const board = boardSubject({
    board: { id: "board-3", name: "Agent health" },
    widgets: [{ name: "Cost per trace" }, { name: "Who uses it" }, { name: "Volume" }],
  });

  describe("given how many of its widgets are empty", () => {
    /** @scenario "AC13d Several empty widgets offer to ask Langy to set them up" */
    it("offers Langy to set them up from two empty widgets, not one", () => {
      expect(offersBoardSetup([])).toBe(false);
      expect(offersBoardSetup(["Cost per trace"])).toBe(false);
      expect(offersBoardSetup(["Cost per trace", "Who uses it"])).toBe(true);
    });
  });

  describe("given Ask Langy to set this up", () => {
    /** @scenario "AC13d Several empty widgets offer to ask Langy to set them up" */
    it("drafts a prompt naming the empty widgets, about the board, and sends nothing", () => {
      const request = boardSetupDraft({
        emptyWidgetNames: ["Cost per trace", "Who uses it"],
        board,
        period: PERIOD,
      });

      expect(request.question).toBeUndefined();
      expect(request.draft).toContain(
        'These widgets on my "Agent health" dashboard show no data: "Cost per trace", "Who uses it".',
      );
      expect(request.draft).toContain("the LangWatch SDK call, the setting or the integration");
      expect(request.draft).not.toContain("2026-09-01T00:00:00Z");
      expect(request.context[0]?.ref).toContain("2026-09-01T00:00:00Z to");
      expect(request.about).toEqual({ ref: "board-3" });
      expect(request.context[0]?.label).toBe("Agent health");
    });
  });
});

describe("an ask made on a new board before it was stored", () => {
  /** @scenario "AC162e Asking Langy on a new board stores it first" */
  it("names the stored board's id in its context and in what the draft is about", () => {
    const board = boardSubject({ board: { id: "new", name: "Untitled dashboard 3" }, widgets: [] });
    const asked = boardSetupDraft({ emptyWidgetNames: [], board, period: PERIOD });

    const told = askAboutStoredBoard({ request: asked, draftId: "new", dashboardId: "board-9" });

    expect(told.context[0]?.ref).toContain('dashboard "Untitled dashboard 3" (id board-9)');
    expect(told.context[0]?.ref).not.toContain("(id new)");
    expect(told.context[0]?.key).toBe("dashboard:board-9");
    expect(told.about).toEqual(asked.about && { ...asked.about, ref: "board-9" });
    expect(told.draft).toBe(asked.draft);
  });

  /** @scenario "AC162e Asking Langy on a new board stores it first" */
  it("leaves a board name that reads like a reference as it was", () => {
    const board = boardSubject({
      board: { id: "new", name: 'Review "x" (id new)' },
      widgets: [{ name: 'dashboard "y" (id new)' }],
    });
    const asked = boardSetupDraft({ emptyWidgetNames: [], board, period: PERIOD });

    const told = askAboutStoredBoard({ request: asked, draftId: "new", dashboardId: "board-9" });

    expect(told.context[0]?.ref).toContain(
      'dashboard "Review \\"x\\" (id new)" (id board-9); widgets: dashboard "y" (id new)',
    );
  });

  /** @scenario "AC162e Asking Langy on a new board stores it first" */
  it("leaves a widget's name and queries as they were, and moves only its key", () => {
    const board = boardSubject({ board: { id: "new", name: "Untitled dashboard 3" }, widgets: [] });
    const widget = {
      id: "w-1",
      name: 'dashboard "y" (id new)',
      definition: { queries: [{ name: "q", sql: "SELECT 'dashboard \"z\" (id new)'" }] },
    };
    const asked = widgetPromptDraft({ widget, board, period: PERIOD });

    const told = askAboutStoredBoard({ request: asked, draftId: "new", dashboardId: "board-9" });

    expect(told.context[1]?.ref).toBe(asked.context[1]?.ref);
    expect(told.context[1]?.key).toBe("dashboard:board-9:widget:w-1");
    expect(told.context[0]?.ref).toContain('"Untitled dashboard 3" (id board-9)');
  });
});

describe("a question asked from a board", () => {
  /** @scenario "AC264d Langy follow-ups: a question from a board's ask bar names that board as where it came from" */
  it("names that board as where it was asked", () => {
    const board = boardSubject({ board: { id: "board-9", name: "Costs" }, widgets: [] });

    expect(boardQuestion({ question: "Why?", board, period: PERIOD }).askedFrom).toBe(
      "dashboard:board-9",
    );
  });

  /** @scenario "AC264d Langy follow-ups: a question from a board's ask bar names that board as where it came from" */
  it("names the stored board once a new board is stored", () => {
    const board = boardSubject({ board: { id: "new", name: "Untitled dashboard 3" }, widgets: [] });
    const asked = boardQuestion({ question: "Why?", board, period: PERIOD });

    const told = askAboutStoredBoard({ request: asked, draftId: "new", dashboardId: "board-9" });

    expect(told.askedFrom).toBe("dashboard:board-9");
  });
});

describe("asking about the same board and widget twice", () => {
  const before = boardSubject({ board: { id: "board-9", name: "Costs" }, widgets: [] });
  const after = boardSubject({
    board: { id: "board-9", name: "Costs" },
    widgets: [{ name: "Which models does my agent use?" }],
  });
  const widget = { name: "Which models does my agent use?", definition: { queries: [] } };

  /** @scenario "AC126c Langy context: a board and a widget asked about again are still listed once" */
  it("keys the board as its chip and the widget by its name, whatever each ask's text says", () => {
    const chip = boardContextChip({ board: after, range: "30d", period: PERIOD });
    const added = widgetPromptDraft({ widget, board: before, period: PERIOD });
    const clicked = widgetChartDraft({
      subject: { kind: "model", label: "gpt-5" },
      widget,
      board: after,
      period: PERIOD,
    });

    expect(added.context[0]?.ref).not.toBe(clicked.context[0]?.ref);
    expect(added.context[0]?.key).toBe(chip.id);
    expect(clicked.context[0]?.key).toBe(chip.id);
    expect(added.context[1]?.ref).not.toBe(clicked.context[1]?.ref);
    expect(added.context[1]?.key).toBe(clicked.context[1]?.key);
  });

  /** @scenario "AC126c Langy context: a board and a widget asked about again are still listed once" */
  it("keys two widgets of one name apart, on one board or on two", () => {
    const other = boardSubject({ board: { id: "board-10", name: "Costs too" }, widgets: [] });
    const keyOf = ({ id, board }: { id: string; board: typeof after }) =>
      widgetPromptDraft({ widget: { ...widget, id }, board, period: PERIOD }).context[1]?.key;

    expect(keyOf({ id: "w-1", board: after })).toBe(keyOf({ id: "w-1", board: after }));
    expect(keyOf({ id: "w-1", board: after })).not.toBe(keyOf({ id: "w-2", board: after }));
    expect(keyOf({ id: "w-1", board: after })).not.toBe(keyOf({ id: "w-1", board: other }));
  });
});
