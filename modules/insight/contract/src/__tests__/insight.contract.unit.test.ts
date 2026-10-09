/**
 * What a filing must carry before it reaches the module.
 * @see modules/insight/specs/insight-inbox.feature
 */

import { describe, expect, it } from "vitest";

import { fileInsightInputSchema } from "../insight.ts";

const FILING = {
  projectId: "project-1",
  title: "Checkout errors doubled",
  body: "Checkout errors doubled overnight.",
  tone: "bad",
};

const REPLAY = {
  start: Date.UTC(2026, 6, 5),
  end: Date.UTC(2026, 7, 4),
  granularitySeconds: 86_400,
  period: "Last 30 days",
  parameters: {},
};

describe("given a file request", () => {
  describe("when its title is empty", () => {
    /** @scenario "An insight without a title is refused" */
    it("refuses it with a field error on the title, blank or only spaces", () => {
      for (const title of ["", "   "]) {
        const result = fileInsightInputSchema.safeParse({ ...FILING, title });

        expect(result.success).toBe(false);
        expect(result.error?.issues.map((issue) => issue.path)).toEqual([["title"]]);
      }
    });
  });

  describe("when it carries a window and no query", () => {
    /** @scenario "A window without a query is refused" */
    it("refuses it with a field error on the window", () => {
      const result = fileInsightInputSchema.safeParse({ ...FILING, replay: REPLAY });

      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.path)).toEqual([["replay"]]);
    });
  });

  describe("when its window ends before it starts", () => {
    /** @scenario "A window that ends before it starts is refused" */
    it("refuses it with a field error on the window's end", () => {
      const result = fileInsightInputSchema.safeParse({
        ...FILING,
        lwql: "SELECT count() FROM traces",
        replay: { ...REPLAY, start: REPLAY.end, end: REPLAY.start },
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.path)).toEqual([["replay", "end"]]);
    });
  });

  describe("when it carries a query with its window, and the board it came from", () => {
    it("is accepted as sent", () => {
      const filing = {
        ...FILING,
        validDays: 7,
        lwql: "SELECT count() FROM traces",
        replay: REPLAY,
        board: { id: "dashboard-1", name: "Checkout health", widget: null },
      };

      expect(fileInsightInputSchema.parse(filing)).toEqual(filing);
    });
  });

  describe("when it carries a title, a body and a tone", () => {
    it("is accepted, staying true for 7 days unless it says otherwise", () => {
      expect(fileInsightInputSchema.parse(FILING)).toEqual({ ...FILING, validDays: 7 });
    });
  });
});
