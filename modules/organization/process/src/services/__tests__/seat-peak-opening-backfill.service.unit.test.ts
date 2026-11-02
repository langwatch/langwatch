/**
 * @vitest-environment node
 * @unit
 * @see modules/organization/specs/seat-peak.feature
 */
import { describe, expect, it } from "vitest";

import { SeatPeakOpeningBackfillService } from "../seat-peak-opening-backfill.service.ts";

const ORGANIZATIONS = ["org_a", "org_b", "org_c"];

/** The backfill over an opener serving two organizations a page; org_b was counted already. */
function backfillOver({ abortAfterPages }: { abortAfterPages?: number } = {}) {
  const opened: string[][] = [];
  const saves: unknown[] = [];
  const controller = new AbortController();
  const service = SeatPeakOpeningBackfillService.create({
    peers: {
      openPage: async ({ afterOrganizationId, dryRun }) => {
        const from =
          afterOrganizationId === null ? 0 : ORGANIZATIONS.indexOf(afterOrganizationId) + 1;
        const page = ORGANIZATIONS.slice(from, from + 2);
        const unopened = page.filter((id) => id !== "org_b");
        if (!dryRun && unopened.length > 0) opened.push(unopened);
        if (abortAfterPages !== undefined && opened.length >= abortAfterPages) controller.abort();
        return {
          lastOrganizationId: page.at(-1) ?? null,
          organizations: page.length,
          opened: dryRun ? 0 : unopened.length,
        };
      },
    },
  });
  const run = ({ after, dryRun = false }: { after?: string; dryRun?: boolean } = {}) =>
    service.backfill({
      after,
      dryRun,
      signal: controller.signal,
      onPage: async (page) => void saves.push(page),
    });
  return { opened, saves, run };
}

describe("given the seat peak's opening snapshot step", () => {
  describe("when it runs over three organizations, one counted already", () => {
    /** @scenario "The opening snapshot step opens every organization not yet counted, a page at a time" */
    it("opens the uncounted ones page by page and saves after each page", async () => {
      const { opened, saves, run } = backfillOver();

      const report = await run();

      expect(opened).toEqual([["org_a"], ["org_c"]]);
      expect(saves).toEqual([{ afterOrganizationId: "org_b" }, { afterOrganizationId: "org_c" }]);
      expect(report).toEqual({ afterOrganizationId: "org_c", organizations: 3, opened: 2 });
    });
  });

  describe("when it resumes after a saved page", () => {
    /** @scenario "The opening snapshot step resumes after the last page it saved" */
    it("opens only the organizations after the saved one", async () => {
      const { opened, run } = backfillOver();

      await run({ after: "org_b" });

      expect(opened).toEqual([["org_c"]]);
    });
  });

  describe("when it runs as a dry run", () => {
    /** @scenario "A dry run of the opening snapshot step opens nothing and saves no checkpoint" */
    it("opens nothing, saves no checkpoint and counts the organizations", async () => {
      const { opened, saves, run } = backfillOver();

      const report = await run({ dryRun: true });

      expect(opened).toEqual([]);
      expect(saves).toEqual([]);
      expect(report).toEqual({ afterOrganizationId: "org_c", organizations: 3, opened: 0 });
    });
  });

  describe("when it is aborted after the first page", () => {
    it("stops before reading the next page", async () => {
      const { opened, saves, run } = backfillOver({ abortAfterPages: 1 });

      const report = await run();

      expect(opened).toEqual([["org_a"]]);
      expect(saves).toEqual([{ afterOrganizationId: "org_b" }]);
      expect(report.afterOrganizationId).toBe("org_b");
    });
  });
});
