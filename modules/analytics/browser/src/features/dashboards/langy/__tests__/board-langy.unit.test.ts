/**
 * What a board hands Langy, as text the agent reads: the open board, the
 * widgets on it and the period it reads over.
 * @see modules/dashboard/specs/dashboards-v1.feature
 */

import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  boardContextChip,
  boardPromptDraft,
  boardQuestion,
  boardSetupDraft,
  boardSubject,
  offersBoardSetup,
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
    /** @scenario "From LangWatch: a template board asks Langy with the board as context" */
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
      expect(request.draft).toContain("Dashboard period: 2026-09-01T00:00:00Z to");
      expect(request.about).toEqual({ ref: "board-3" });
      expect(request.context[0]?.label).toBe("Agent health");
    });
  });
});
