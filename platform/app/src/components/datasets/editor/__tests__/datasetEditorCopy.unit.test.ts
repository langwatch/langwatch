import { describe, expect, it } from "vitest";
import {
  formatSearchRecordCount,
  noSearchMatchesMessage,
  searchFailedMessage,
  truncatedReadTooltip,
} from "../datasetEditorCopy";

describe("given a dataset whose editor read is truncated", () => {
  describe("when building the count tooltip", () => {
    it("states what is shown vs the total and how to get the full data", () => {
      const copy = truncatedReadTooltip({ shown: 3, total: 1640 });

      // Pin the customer-facing message so it can't silently drift.
      expect(copy).toBe(
        "This dataset is too large to display in full here — showing 3 out of 1,640 rows. Editing a visible row saves just that row; use Download as CSV for the complete dataset.",
      );
    });

    it("formats both counts with a fixed en-US thousands separator (locale-independent)", () => {
      const copy = truncatedReadTooltip({ shown: 10, total: 1000000 });
      expect(copy).toContain("showing 10 out of 1,000,000 rows");
    });
  });
});

describe("given a search is in effect", () => {
  describe("when building the count chip", () => {
    it("reports the matches and the dataset total, so neither number misleads alone", () => {
      // Pin the customer-facing message so it can't silently drift.
      expect(formatSearchRecordCount({ matched: 3, total: 679 })).toBe(
        "3 of 679 records",
      );
    });

    it("says zero rather than going blank when nothing matched", () => {
      expect(formatSearchRecordCount({ matched: 0, total: 679 })).toBe(
        "0 of 679 records",
      );
    });

    it("formats both counts with a fixed en-US thousands separator (locale-independent)", () => {
      expect(formatSearchRecordCount({ matched: 1200, total: 1000000 })).toBe(
        "1,200 of 1,000,000 records",
      );
    });

    it("drops the total rather than inventing one when the dataset's size is unknown", () => {
      // Reusing the match count for both halves would render "1 of 1 records"
      // for a dataset of any size — the "it has shrunk" misreading the pair of
      // numbers exists to prevent.
      expect(formatSearchRecordCount({ matched: 1 })).toBe("1 matching record");
      expect(formatSearchRecordCount({ matched: 1200 })).toBe(
        "1,200 matching records",
      );
    });
  });

  describe("when the search could not be run", () => {
    it("names the search that failed, so the message is tied to it", () => {
      expect(searchFailedMessage("escalation")).toBe(
        "Couldn’t run the search for “escalation”.",
      );
    });
  });

  describe("when nothing matched", () => {
    it("repeats the searched text, so the message is tied to a search", () => {
      expect(noSearchMatchesMessage("escalation")).toBe(
        "No records match “escalation”.",
      );
    });
  });
});
