/**
 * @vitest-environment node
 * Spec: modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { ORGANIZATION_ID_PAGE_LIMIT } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import { InstantEvalJudgeSpendBackfillService } from "../instant-eval-judge-spend-backfill.service.ts";

const ORGANIZATIONS = ["org_a", "org_b", "org_c"];

/** The spend backfill over an organization twin serving two ids a page; each holds one row. */
function backfillOver() {
  const asked: unknown[] = [];
  const copies: { organizationId: string; isDryRun: boolean }[] = [];
  const saves: unknown[] = [];
  const service = InstantEvalJudgeSpendBackfillService.create({
    peers: {
      organizations: {
        listAllIds: async (input) => {
          asked.push(input);
          const from = input?.after === undefined ? 0 : ORGANIZATIONS.indexOf(input.after) + 1;
          const ids = ORGANIZATIONS.slice(from, from + 2);
          return { ids, next: from + 2 < ORGANIZATIONS.length ? (ids.at(-1) ?? null) : null };
        },
      },
      copy: async ({ organizationId, isDryRun }) => {
        copies.push({ organizationId, isDryRun });
        const copied = isDryRun ? 0 : 1;
        return { ledgerRows: 1, ledgerNanoUsd: 10, copied, alreadyHeld: 0 };
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
  return { asked, copies, saves, run };
}

describe("given the spend catch-up step's backfill", () => {
  describe("when it runs over three organizations", () => {
    it("copies each organization a page at a time and saves after each page", async () => {
      const { asked, saves, run } = backfillOver();

      const report = await run();

      expect(asked).toEqual([
        { after: undefined, limit: ORGANIZATION_ID_PAGE_LIMIT },
        { after: "org_b", limit: ORGANIZATION_ID_PAGE_LIMIT },
      ]);
      expect(saves).toEqual([{ afterOrganizationId: "org_b" }, { afterOrganizationId: "org_c" }]);
      expect(report).toEqual({
        afterOrganizationId: "org_c",
        organizations: 3,
        ledgerRows: 3,
        ledgerNanoUsd: 30,
        copied: 3,
        alreadyHeld: 0,
      });
    });
  });

  describe("when it resumes after a saved page", () => {
    /** @scenario "The spend catch-up step resumes after the last page of organizations it saved" */
    it("copies only the organizations after the saved one", async () => {
      const { copies, run } = backfillOver();

      await run({ after: "org_b" });

      expect(copies.map((call) => call.organizationId)).toEqual(["org_c"]);
    });
  });

  describe("when it runs as a dry run", () => {
    /** @scenario "A dry run of the spend catch-up step copies nothing and saves no checkpoint" */
    it("copies nothing and saves no checkpoint", async () => {
      const { saves, run } = backfillOver();

      const report = await run({ dryRun: true });

      expect(report.copied).toBe(0);
      expect(saves).toEqual([]);
    });
  });
});
