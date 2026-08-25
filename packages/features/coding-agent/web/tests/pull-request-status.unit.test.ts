/**
 * @vitest-environment node
 * @unit
 *
 * How the stored snapshot reads where a pull request stands.
 */
import { describe, expect, it } from "vitest";

import { derivePullRequestStatus } from "../src/pull-request-status";

describe("derivePullRequestStatus", () => {
  describe("given a merged pull request", () => {
    /** @scenario "The stored snapshot derives merged, closed, draft and open" */
    it("reads merged even though GitHub also closed it", () => {
      expect(
        derivePullRequestStatus({
          state: "closed",
          isDraft: false,
          prMergedAtMs: new Date("2026-08-01T10:00:00Z").getTime(),
        }),
      ).toBe("merged");
    });

    /** @scenario "The stored snapshot derives merged, closed, draft and open" */
    it("reads merged even though it was a draft on the way", () => {
      expect(
        derivePullRequestStatus({
          state: "closed",
          isDraft: true,
          prMergedAtMs: new Date("2026-08-01T10:00:00Z").getTime(),
        }),
      ).toBe("merged");
    });
  });

  describe("given a closed pull request that never merged", () => {
    /** @scenario "The stored snapshot derives merged, closed, draft and open" */
    it("reads closed", () => {
      expect(
        derivePullRequestStatus({
          state: "closed",
          isDraft: false,
          prMergedAtMs: null,
        }),
      ).toBe("closed");
    });

    /** @scenario "The stored snapshot derives merged, closed, draft and open" */
    it("reads closed rather than draft", () => {
      expect(
        derivePullRequestStatus({
          state: "closed",
          isDraft: true,
          prMergedAtMs: null,
        }),
      ).toBe("closed");
    });
  });

  describe("given an open pull request marked as a draft", () => {
    /** @scenario "The stored snapshot derives merged, closed, draft and open" */
    it("reads draft", () => {
      expect(
        derivePullRequestStatus({
          state: "open",
          isDraft: true,
          prMergedAtMs: null,
        }),
      ).toBe("draft");
    });
  });

  describe("given an open pull request ready for review", () => {
    /** @scenario "The stored snapshot derives merged, closed, draft and open" */
    it("reads open", () => {
      expect(
        derivePullRequestStatus({
          state: "open",
          isDraft: false,
          prMergedAtMs: null,
        }),
      ).toBe("open");
    });
  });
});
