/**
 * @vitest-environment node
 * Spec: modules/organization/specs/organization-service.feature
 */
import { describe, expect, it } from "vitest";

import { OrganizationPresenceSettingBackfillService } from "../organization-presence-setting-backfill.service.ts";

const ORGANIZATIONS = ["org_a", "org_b", "org_c"];

/** The backfill over a settings twin serving two organizations a page; each page is one batch. */
function backfillOver() {
  const batches: string[][] = [];
  const saves: unknown[] = [];
  const service = OrganizationPresenceSettingBackfillService.create({
    peers: {
      recordPage: async ({ afterOrganizationId, dryRun }) => {
        const from =
          afterOrganizationId === null ? 0 : ORGANIZATIONS.indexOf(afterOrganizationId) + 1;
        const page = ORGANIZATIONS.slice(from, from + 2);
        if (!dryRun && page.length > 0) batches.push(page);
        return { lastOrganizationId: page.at(-1) ?? null, organizations: page.length };
      },
    },
  });
  const run = ({ after, dryRun = false }: { after?: string; dryRun?: boolean } = {}) =>
    service.backfill({
      after,
      dryRun,
      signal: new AbortController().signal,
      onPage: async (page) => void saves.push(page),
    });
  return { batches, saves, run };
}

describe("given the organization presence step's backfill", () => {
  describe("when it runs over three organizations", () => {
    /** @scenario "The organization presence step records every organization a page at a time" */
    it("records each page as one batch and saves after each page", async () => {
      const { batches, saves, run } = backfillOver();

      const report = await run();

      expect(batches).toEqual([["org_a", "org_b"], ["org_c"]]);
      expect(saves).toEqual([{ afterOrganizationId: "org_b" }, { afterOrganizationId: "org_c" }]);
      expect(report).toEqual({ afterOrganizationId: "org_c", organizations: 3, recorded: 3 });
    });
  });

  describe("when it resumes after a saved page", () => {
    /** @scenario "The organization presence step resumes after the last page it saved" */
    it("records only the organizations after the saved one", async () => {
      const { batches, run } = backfillOver();

      await run({ after: "org_b" });

      expect(batches).toEqual([["org_c"]]);
    });
  });

  describe("when it runs as a dry run", () => {
    /** @scenario "A dry run of the organization presence step records nothing and saves no checkpoint" */
    it("records nothing, saves no checkpoint and counts the organizations", async () => {
      const { batches, saves, run } = backfillOver();

      const report = await run({ dryRun: true });

      expect(batches).toEqual([]);
      expect(saves).toEqual([]);
      expect(report).toEqual({ afterOrganizationId: "org_c", organizations: 3, recorded: 0 });
    });
  });
});
