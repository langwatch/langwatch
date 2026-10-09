/**
 * The line under an insight's title, as the page prints it.
 * @see modules/insight/specs/insight-inbox.feature
 */

import { describe, expect, it } from "vitest";

import { insightEntry } from "../../testing.tsx";
import { insightValidity } from "../insight-presentation.ts";

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
