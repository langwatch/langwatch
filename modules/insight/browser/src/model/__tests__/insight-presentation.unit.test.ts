/**
 * The line under an insight's title as the page prints it, and the plain text Copy writes.
 * @see modules/insight/specs/insight-inbox.feature
 */

import { describe, expect, it } from "vitest";

import { insightEntry } from "../../testing.tsx";
import { insightPlainText, insightValidity, replayCaption } from "../insight-presentation.ts";

const DAY_MS = 86_400_000;
/** Midday, so a day in any time zone the suite runs in is the same calendar day. */
const NOW = new Date(2026, 9, 9, 12).getTime();

describe("given an insight filed 3 days ago that stays true for 7 days", () => {
  const filed = { filedAt: NOW - 3 * DAY_MS, validDays: 7 };

  describe("when a later run found it still true today", () => {
    /** @scenario "An insight seen again today says so" */
    it("reads seen again today, still true through the day its validity ends", () => {
      const entry = insightEntry({ ...filed, renewedAt: NOW });

      expect(insightValidity({ entry, folder: "inbox", now: NOW })).toEqual({
        text: "Seen again today · still true through Oct 16",
        tone: "ok",
      });
    });
  });

  describe("when a later run found it still true 2 days ago", () => {
    /** @scenario "An insight seen again on an earlier day names that day" */
    it("names that day, then the day its validity ends", () => {
      const entry = insightEntry({ ...filed, renewedAt: NOW - 2 * DAY_MS });

      expect(insightValidity({ entry, folder: "inbox", now: NOW })).toEqual({
        text: "Seen again Oct 7 · still true through Oct 14",
        tone: "ok",
      });
    });
  });

  describe("when the reader kept it", () => {
    /** @scenario "A kept insight says it was kept as still relevant" */
    it("reads kept as still relevant", () => {
      const entry = insightEntry({ ...filed, keptAt: NOW });

      expect(insightValidity({ entry, folder: "inbox", now: NOW })).toEqual({
        text: "Kept as still relevant",
        tone: "ok",
      });
    });
  });
});

describe("given a window from Jul 5 to Aug 3 with the period Last 30 days and a model parameter", () => {
  const replay = {
    start: new Date(2026, 6, 5).getTime(),
    end: new Date(2026, 7, 4).getTime(),
    granularitySeconds: 86_400,
    period: "Last 30 days",
    parameters: { model: "gpt-5" },
  };

  describe("when the line under the chart is written for an insight from a board", () => {
    /** @scenario "The line under the chart names the dates and every value in force" */
    it("names the first and last day, the period and the parameter, then the board sentence", () => {
      expect(replayCaption({ replay, fromBoard: true })).toBe(
        "Replayed with: Jul 5 to Aug 3 · Last 30 days · model: gpt-5. " +
          "The board as it was set when Langy filed this.",
      );
    });
  });

  describe("when the window was not kept from a board", () => {
    it("names the dates and values and says nothing of a board", () => {
      expect(
        replayCaption({ replay: { ...replay, period: null, parameters: {} }, fromBoard: false }),
      ).toBe("Replayed with: Jul 5 to Aug 3.");
    });
  });

  describe("when the window is one day", () => {
    it("names that day once", () => {
      const oneDay = {
        ...replay,
        end: new Date(2026, 6, 6).getTime(),
        period: null,
        parameters: {},
      };

      expect(replayCaption({ replay: oneDay, fromBoard: false })).toBe("Replayed with: Jul 5.");
    });
  });
});

describe("given an insight from a widget on a board, with a window from Jul 5 to Aug 3 2026", () => {
  const entry = insightEntry({
    title: "Checkout errors doubled",
    body:
      "Checkout errors doubled overnight: 240 failed against 118 the day before.\n\n" +
      "**What to do**\n\n" +
      "Roll back the gateway change.",
    board: {
      id: "board-1",
      name: "Checkout health",
      widget: { id: "widget-1", name: "Errors by day" },
    },
    lwql: "SELECT count() FROM traces WHERE model = {model:String}",
    replay: {
      start: new Date(2026, 6, 5).getTime(),
      end: new Date(2026, 7, 4).getTime(),
      granularitySeconds: 86_400,
      period: "Last 30 days",
      parameters: { model: "gpt-5" },
    },
  });

  describe("when its plain text is written", () => {
    /** @scenario "The copied text carries the title, the body, the fixed period and the board" */
    it("reads the title, the body as Langy wrote it, the period with its year and values, and the board", () => {
      expect(insightPlainText(entry)).toBe(
        [
          "Checkout errors doubled",
          "",
          "Checkout errors doubled overnight: 240 failed against 118 the day before.",
          "",
          "What to do",
          "",
          "Roll back the gateway change.",
          "",
          "Period: Jul 5 to Aug 3, 2026 · Last 30 days · model: gpt-5",
          "From: Checkout health › Errors by day",
        ].join("\n"),
      );
    });
  });
});

describe("given an insight filed with no board and no window", () => {
  describe("when its plain text is written", () => {
    /** @scenario "The copied text of an insight with no board and no window is its title and body" */
    it("reads the title and the body, and names no period and no board", () => {
      const entry = insightEntry({
        title: "Checkout errors doubled",
        body: "Checkout errors doubled overnight.",
      });

      expect(insightPlainText(entry)).toBe(
        "Checkout errors doubled\n\nCheckout errors doubled overnight.",
      );
    });
  });
});
