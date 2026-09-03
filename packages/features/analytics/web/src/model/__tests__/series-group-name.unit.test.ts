import { describe, expect, it } from "vitest";

import { formatSeriesGroupName, formatSingleSeriesName } from "../series-group-name";

const groupName = (overrides: Partial<Parameters<typeof formatSeriesGroupName>[0]> = {}) =>
  formatSeriesGroupName({
    groupBy: "evaluations.evaluation_passed",
    groupKey: "passed",
    groupLabel: "Evaluation Passed",
    hideGroupLabel: false,
    ...overrides,
  });

/** What the chart actually renders for a chart carrying one series. */
const rendered = (overrides: Partial<Parameters<typeof formatSeriesGroupName>[0]> = {}) =>
  formatSingleSeriesName(groupName(overrides));

describe("formatSeriesGroupName", () => {
  describe("given the evaluation verdict group-by", () => {
    it("names the no-verdict bucket for what it is, not 'unknown'", () => {
      expect(rendered({ groupKey: "unknown" })).toBe("No verdict");
    });

    it("does not say the evaluation passed unknown", () => {
      expect(rendered({ groupKey: "unknown" })).not.toContain("unknown");
    });

    it("keeps naming the two real verdicts", () => {
      expect(rendered({ groupKey: "passed" })).toBe("Evaluation Passed");
      expect(rendered({ groupKey: "failed" })).toBe("Evaluation Failed");
    });

    // The verdict is the whole label, so hiding the group label cannot leave
    // a bare "unknown" behind.
    it("names the bucket the same way when the group label is hidden", () => {
      expect(groupName({ groupKey: "unknown", hideGroupLabel: true })).toBe("No verdict");
    });

    // The verdict column never emits an empty bucket, but if it ever did, the
    // generic path would rebuild "evaluation passed unknown", which is the
    // string this whole change exists to remove.
    it("names an empty verdict bucket 'No verdict' too", () => {
      expect(rendered({ groupKey: "" })).toBe("No verdict");
    });

    it("leaves a bucket it does not know alone", () => {
      expect(groupName({ groupKey: "skipped" })).toBe("evaluation passed skipped");
    });
  });

  describe("given a different group-by that happens to bucket on 'passed'", () => {
    /**
     * The verdict labels are keyed to the evaluation verdict group-by, not to
     * the words. An evaluation label, or a metadata value, may legitimately be
     * the string "passed" and must keep reading as its own bucket rather than
     * being relabelled as an evaluation verdict.
     */
    it("does not borrow the evaluation verdict labels", () => {
      expect(
        groupName({
          groupBy: "evaluations.evaluation_label",
          groupKey: "passed",
          groupLabel: "Evaluation Label",
        }),
      ).toBe("evaluation label passed");
    });

    it("does not borrow the no-verdict label either", () => {
      expect(
        groupName({
          groupBy: "metadata.user_id",
          groupKey: "unknown",
          groupLabel: "User ID",
        }),
      ).toBe("user id unknown");
    });
  });

  describe("given a series that is not grouped", () => {
    it("contributes no name at all, so the series keeps its own", () => {
      expect(groupName({ groupKey: undefined })).toBe("");
    });
  });

  describe("given a row whose group value is empty", () => {
    /**
     * Regression: the label prefix was `group?.label.toLowerCase() + " "`, and
     * the group was only looked up when the key was truthy. An empty key made
     * that `undefined + " "`, so the chart rendered the string "Undefined
     * unknown" at the user.
     */
    it("does not render the word 'undefined' at the user", () => {
      const name = rendered({
        groupBy: "metadata.user_id",
        groupKey: "",
        groupLabel: undefined,
      });

      expect(name.toLowerCase()).not.toContain("undefined");
      expect(name).toBe("Unknown");
    });

    it("still labels the bucket when the group label is known", () => {
      expect(
        groupName({
          groupBy: "metadata.user_id",
          groupKey: "",
          groupLabel: "User ID",
        }),
      ).toBe("user id unknown");
    });
  });

  describe("given any other group-by", () => {
    it("prefixes the bucket with the group's own label", () => {
      expect(
        groupName({
          groupBy: "metadata.user_id",
          groupKey: "u-1",
          groupLabel: "User ID",
        }),
      ).toBe("user id u-1");
    });

    it("drops the prefix when the caller hides the group label", () => {
      expect(
        groupName({
          groupBy: "metadata.user_id",
          groupKey: "u-1",
          groupLabel: "User ID",
          hideGroupLabel: true,
        }),
      ).toBe("u-1");
    });
  });
});

describe("formatSingleSeriesName", () => {
  describe("given a group name carrying a recognised prefix", () => {
    it.each([
      { groupName: "contains error true", expected: "Traces true" },
      { groupName: "evaluation label helpful", expected: "helpful" },
      { groupName: "thumbs up/down positive", expected: "positive" },
    ])("shortens $groupName to $expected", ({ groupName, expected }) => {
      expect(formatSingleSeriesName(groupName)).toBe(expected);
    });
  });

  describe("given an ordinary group name", () => {
    it("uppercases the first letter and leaves the rest alone", () => {
      expect(formatSingleSeriesName("user id u-1")).toBe("User id u-1");
    });
  });

  describe("given an empty group name", () => {
    it("passes it through, so the series keeps its own name", () => {
      expect(formatSingleSeriesName("")).toBe("");
    });
  });
});
