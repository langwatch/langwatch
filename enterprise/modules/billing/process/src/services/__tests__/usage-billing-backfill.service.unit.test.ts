// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Spec: enterprise/modules/billing/specs/billing.feature
 */
import { ORGANIZATION_ID_PAGE_LIMIT } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import { UsageBillingBackfillService } from "../usage-billing-backfill.service.ts";

const ORGANIZATIONS = ["org_a", "org_b", "org_c"];

/** Billing's backfill over an organization twin serving two ids a page. */
function backfillOver() {
  const asked: unknown[] = [];
  const caughtUp: { organizationId: string; isDryRun: boolean }[] = [];
  const saves: unknown[] = [];
  const service = UsageBillingBackfillService.create({
    peers: {
      organizations: {
        listIds: async (input) => {
          asked.push(input);
          const from = input?.after === undefined ? 0 : ORGANIZATIONS.indexOf(input.after) + 1;
          const ids = ORGANIZATIONS.slice(from, from + 2);
          return { ids, next: from + 2 < ORGANIZATIONS.length ? (ids.at(-1) ?? null) : null };
        },
      },
      catchUp: async (input) => {
        caughtUp.push(input);
        return { usageBilled: input.organizationId !== "org_b" };
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
  return { asked, caughtUp, saves, run };
}

describe("given the usage-billing catch-up step's backfill", () => {
  describe("when it runs over three organizations", () => {
    it("records each organization a page at a time and saves after each page", async () => {
      const { asked, saves, run } = backfillOver();

      const report = await run();

      expect(asked).toEqual([
        { after: undefined, limit: ORGANIZATION_ID_PAGE_LIMIT },
        { after: "org_b", limit: ORGANIZATION_ID_PAGE_LIMIT },
      ]);
      expect(saves).toEqual([{ afterOrganizationId: "org_b" }, { afterOrganizationId: "org_c" }]);
      expect(report).toEqual({ afterOrganizationId: "org_c", organizations: 3, usageBilled: 2 });
    });
  });

  describe("when it resumes after a saved page", () => {
    /** @scenario "The usage-billing catch-up step resumes after the last page of organizations it saved" */
    it("records only the organizations after the saved one", async () => {
      const { caughtUp, run } = backfillOver();

      await run({ after: "org_b" });

      expect(caughtUp.map((call) => call.organizationId)).toEqual(["org_c"]);
    });
  });

  describe("when it runs as a dry run", () => {
    /** @scenario "A dry run of the usage-billing catch-up step records nothing and saves no checkpoint" */
    it("only reads each organization and saves no checkpoint", async () => {
      const { caughtUp, saves, run } = backfillOver();

      await run({ dryRun: true });

      expect(caughtUp.every((call) => call.isDryRun)).toBe(true);
      expect(caughtUp).toHaveLength(3);
      expect(saves).toEqual([]);
    });
  });
});
