/**
 * @see modules/dashboard/specs/dashboards-v2.feature AC213
 */
import type { LangWatchQLDiagnostic } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { widgetLimitNotes } from "../widget-limit-notes.ts";

const SOURCES_IGNORED: LangWatchQLDiagnostic = {
  code: "SOURCES_IGNORED",
  message: "This query doesn't read {dashboard_context_sources}, so it counts every origin.",
};
const SHARE_WINDOW_LIMITED: LangWatchQLDiagnostic = {
  code: "SHARE_WINDOW_LIMITED",
  message: "Some projects share data only from a date, so earlier rows are not included",
};
const GRANULARITY_COARSENED: LangWatchQLDiagnostic = {
  code: "GRANULARITY_COARSENED",
  message:
    "The period is too long for 60-second steps, so the query ran at 3600-second steps.",
};

describe("widgetLimitNotes", () => {
  describe("given a run that ignored the sources setting", () => {
    /** @scenario "AC213 Diagnostics: a card shows what the server limited as one (i) line" */
    it("says it in the card's words, with no placeholder", () => {
      const [note] = widgetLimitNotes([SOURCES_IGNORED]);

      expect(note).toBe(
        "This query counts every source, because its SQL does not read the sources setting.",
      );
      expect(note).not.toContain("{");
    });
  });

  describe("given the other limiting diagnostics", () => {
    /** @scenario "AC213 Diagnostics: a card shows what the server limited as one (i) line" */
    it("keeps the server's message, which names no placeholder", () => {
      expect(widgetLimitNotes([SHARE_WINDOW_LIMITED, GRANULARITY_COARSENED])).toEqual([
        SHARE_WINDOW_LIMITED.message,
        GRANULARITY_COARSENED.message,
      ]);
    });
  });

  describe("given a diagnostic that limited nothing", () => {
    it("leaves it off the line", () => {
      expect(widgetLimitNotes([{ code: "POSSIBLE_FANOUT", message: "x" }])).toEqual([]);
    });
  });
});
