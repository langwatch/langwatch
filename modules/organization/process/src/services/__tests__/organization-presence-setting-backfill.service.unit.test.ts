/**
 * @vitest-environment node
 * Spec: modules/organization/specs/organization-service.feature
 */
import { ORGANIZATION_ID_PAGE_LIMIT } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import { OrganizationPresenceSettingBackfillService } from "../organization-presence-setting-backfill.service.ts";

const ORGANIZATIONS = ["org_a", "org_b", "org_c"];

/** The backfill over an organization twin serving two ids a page. */
function backfillOver() {
  const asked: unknown[] = [];
  const recorded: string[] = [];
  const saves: unknown[] = [];
  const service = OrganizationPresenceSettingBackfillService.create({
    peers: {
      organizations: {
        listAllIds: async (input) => {
          asked.push(input);
          const from = input?.after === undefined ? 0 : ORGANIZATIONS.indexOf(input.after) + 1;
          const ids = ORGANIZATIONS.slice(from, from + 2);
          return { ids, next: from + 2 < ORGANIZATIONS.length ? (ids.at(-1) ?? null) : null };
        },
      },
      record: async ({ organizationId }) => {
        recorded.push(organizationId);
        return true;
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
  return { asked, recorded, saves, run };
}

describe("given the organization presence step's backfill", () => {
  describe("when it runs over three organizations", () => {
    /** @scenario "The organization presence step records every organization a page at a time" */
    it("records each organization a page at a time and saves after each page", async () => {
      const { asked, recorded, saves, run } = backfillOver();

      const report = await run();

      expect(asked).toEqual([
        { after: undefined, limit: ORGANIZATION_ID_PAGE_LIMIT },
        { after: "org_b", limit: ORGANIZATION_ID_PAGE_LIMIT },
      ]);
      expect(recorded).toEqual(ORGANIZATIONS);
      expect(saves).toEqual([{ afterOrganizationId: "org_b" }, { afterOrganizationId: "org_c" }]);
      expect(report).toEqual({ afterOrganizationId: "org_c", organizations: 3, recorded: 3 });
    });
  });

  describe("when it resumes after a saved page", () => {
    /** @scenario "The organization presence step resumes after the last page it saved" */
    it("records only the organizations after the saved one", async () => {
      const { recorded, run } = backfillOver();

      await run({ after: "org_b" });

      expect(recorded).toEqual(["org_c"]);
    });
  });

  describe("when it runs as a dry run", () => {
    /** @scenario "A dry run of the organization presence step records nothing and saves no checkpoint" */
    it("records nothing, saves no checkpoint and counts the organizations", async () => {
      const { recorded, saves, run } = backfillOver();

      const report = await run({ dryRun: true });

      expect(recorded).toEqual([]);
      expect(saves).toEqual([]);
      expect(report).toEqual({ afterOrganizationId: "org_c", organizations: 3, recorded: 0 });
    });
  });
});
