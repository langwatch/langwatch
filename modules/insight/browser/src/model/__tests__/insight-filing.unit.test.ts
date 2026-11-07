/**
 * What "Save as insight" files from a Langy answer: a finding of its insights card as typed
 * data, or the answer's own prose and subject when it carries no card.
 * @see modules/insight/specs/insight-inbox.feature
 */

import type { LangyInsightsCardFinding } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import {
  draftOfAnswer,
  draftOfFinding,
  fileableFindings,
  type FileableFinding,
  filedFinding,
  filedSubject,
} from "../insight-filing.ts";

const WINDOW = { start: 1_783_209_600_000, end: 1_783_296_000_000, granularitySeconds: 3_600 };
const BOARD = { id: "board-1", name: "Checkout health" };

const finding = (overrides: Partial<LangyInsightsCardFinding> = {}): LangyInsightsCardFinding => ({
  title: "Checkout errors doubled",
  body: "Errors on checkout rose from 41 to 96.",
  tone: "bad",
  ...overrides,
});

/** A finding that names a next step, as `fileableFindings` hands it to the form. */
const fileable = (overrides: Partial<FileableFinding> = {}): FileableFinding => ({
  title: "Checkout errors doubled",
  body: "Errors on checkout rose from 41 to 96.",
  tone: "bad",
  ...overrides,
});

describe("fileableFindings", () => {
  describe("given a card with bad, watch and good findings", () => {
    /** @scenario "A good finding of an insights card is never filed" */
    it("keeps the bad and the watch findings in order, and drops the good one", () => {
      const findings = [
        finding({ title: "Errors doubled", tone: "bad" }),
        finding({ title: "Cost per trace fell", tone: "good" }),
        finding({ title: "Latency crept up", tone: "watch" }),
      ];

      expect(fileableFindings({ findings }).map(({ title, tone }) => ({ title, tone }))).toEqual([
        { title: "Errors doubled", tone: "bad" },
        { title: "Latency crept up", tone: "watch" },
      ]);
    });
  });

  describe("given no card", () => {
    it("has nothing to file", () => {
      expect(fileableFindings(undefined)).toEqual([]);
    });
  });
});

describe("draftOfFinding", () => {
  describe("given one finding of an answer's insights card", () => {
    it("starts the form with the finding's own words, verdict, topic and validity", () => {
      expect(draftOfFinding(fileable({ topic: "errors", validDays: 14 }))).toEqual({
        title: "Checkout errors doubled",
        body: "Errors on checkout rose from 41 to 96.",
        tone: "bad",
        topic: "errors",
        validDays: 14,
      });
    });

    it("leaves the topic empty and the validity at a week when the finding names neither", () => {
      expect(draftOfFinding(fileable())).toMatchObject({ topic: "", validDays: 7 });
    });

    it("keeps a bad or a watch finding's own verdict", () => {
      expect(draftOfFinding(fileable({ tone: "watch" })).tone).toBe("watch");
      expect(draftOfFinding(fileable({ tone: "bad" })).tone).toBe("bad");
    });
  });
});

describe("draftOfAnswer", () => {
  describe("given an answer with no card", () => {
    it("takes its first line as the title and its prose as the body, worth a look", () => {
      expect(draftOfAnswer("**Costs doubled**\n\nOn checkout, overnight.")).toEqual({
        title: "Costs doubled",
        body: "**Costs doubled**\n\nOn checkout, overnight.",
        tone: "watch",
        topic: "",
        validDays: 7,
      });
    });
  });
});

describe("filedFinding", () => {
  describe("given a card that names its board and its window", () => {
    /** @scenario "Saving a finding of an answer's insights card files its typed data" */
    it("files the board with the finding's widget, its query and the card's window", () => {
      const filed = filedFinding({
        card: { board: BOARD, window: WINDOW },
        finding: finding({ widgetId: "widget-1", widgetName: "Errors by day", lwql: "SELECT 1" }),
      });

      expect(filed).toEqual({
        board: { ...BOARD, widget: { id: "widget-1", name: "Errors by day" } },
        lwql: "SELECT 1",
        replay: { ...WINDOW, period: null, parameters: {} },
      });
    });

    it("points at the board alone for a finding that names a widget id and no name", () => {
      const filed = filedFinding({
        card: { board: BOARD, window: WINDOW },
        finding: finding({ widgetId: "widget-1" }),
      });

      expect(filed).toEqual({ board: { ...BOARD, widget: null } });
    });

    it("files no window for a finding with no query: a window needs the query it replays", () => {
      expect(filedFinding({ card: { window: WINDOW }, finding: finding() })).toEqual({});
    });
  });

  describe("given a card whose window does not end after it starts", () => {
    it("files the query with no window, so the filing is not refused whole", () => {
      const filed = filedFinding({
        card: { window: { start: 2, end: 1, granularitySeconds: 60 } },
        finding: finding({ lwql: "SELECT 1" }),
      });

      expect(filed).toEqual({ lwql: "SELECT 1" });
    });
  });
});

describe("filedSubject", () => {
  describe("given an answer with no subject", () => {
    it("files no pointer, no query and no window", () => {
      expect(filedSubject(undefined)).toEqual({});
    });
  });
});
