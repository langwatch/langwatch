// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/customer-io-plan-traits.feature
 */
import { ORGANIZATION_ID_PAGE_LIMIT } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import { CustomerIoPlanResyncService } from "../customer-io-plan-resync.service.ts";

/** Three organizations, two a page; org_b has no active member. */
const MEMBERS = new Map([
  ["org_a", 2],
  ["org_b", 0],
  ["org_c", 250],
]);
const ORGANIZATIONS = [...MEMBERS.keys()];

/** The resync over an organization twin serving two ids a page and a recording catch-up. */
function resyncOver({ abortAfter }: { abortAfter?: string } = {}) {
  const controller = new AbortController();
  const caughtUp: { organizationId: string; isDryRun: boolean }[] = [];
  const saves: { afterOrganizationId: string }[] = [];
  const service = CustomerIoPlanResyncService.create({
    peers: {
      organizations: {
        listIds: async (input) => {
          const from = input?.after === undefined ? 0 : ORGANIZATIONS.indexOf(input.after) + 1;
          const ids = ORGANIZATIONS.slice(from, from + 2);
          return { ids, next: from + 2 < ORGANIZATIONS.length ? (ids.at(-1) ?? null) : null };
        },
      },
      catchUp: async (input) => {
        caughtUp.push(input);
        if (input.organizationId === abortAfter) controller.abort();
        return { members: MEMBERS.get(input.organizationId) ?? 0 };
      },
    },
  });
  const run = ({ dryRun = false }: { dryRun?: boolean } = {}) =>
    service.resync({
      dryRun,
      signal: controller.signal,
      onPage: async (page) => void saves.push(page),
    });
  return { caughtUp, saves, run };
}

describe("CustomerIoPlanResyncService", () => {
  describe("when it runs over three organizations", () => {
    it("records a fact per organization with members, a page at a time, saving after each page", async () => {
      const { caughtUp, saves, run } = resyncOver();

      const report = await run();

      expect(caughtUp.map(({ organizationId }) => organizationId)).toEqual(ORGANIZATIONS);
      expect(saves).toEqual([{ afterOrganizationId: "org_b" }, { afterOrganizationId: "org_c" }]);
      expect(report).toEqual({
        afterOrganizationId: "org_c",
        organizations: 3,
        members: 252,
        factsRecorded: 2,
        maxGroupCalls: 2,
        maxIdentifies: 252,
        skipped: { no_active_members: 1 },
      });
    });
  });

  describe("when it runs as a dry run", () => {
    /** @scenario "A dry run of the resync sends nothing and saves no checkpoint" */
    it("only reads, records no fact, saves no checkpoint and reports what it would send", async () => {
      const { caughtUp, saves, run } = resyncOver();

      const report = await run({ dryRun: true });

      expect(caughtUp.every(({ isDryRun }) => isDryRun)).toBe(true);
      expect(saves).toEqual([]);
      expect(report).toMatchObject({
        organizations: 3,
        members: 252,
        factsRecorded: 0,
        maxGroupCalls: 2,
        maxIdentifies: 252,
        skipped: { no_active_members: 1 },
      });
    });
  });

  describe("given an organization with no active members and an abort after the first page", () => {
    /** @scenario "A resync skips organizations with no members and stops on abort" */
    it("counts the empty one skipped, and stops between organizations", async () => {
      const aborted = resyncOver({ abortAfter: "org_b" });

      const report = await aborted.run();

      expect(report.skipped).toEqual({ no_active_members: 1 });
      expect(aborted.caughtUp.map(({ organizationId }) => organizationId)).toEqual([
        "org_a",
        "org_b",
      ]);
      expect(aborted.saves).toEqual([{ afterOrganizationId: "org_b" }]);
    });

    it("saves no page it stopped part way through", async () => {
      const { caughtUp, saves, run } = resyncOver({ abortAfter: "org_a" });

      const report = await run();

      expect(caughtUp.map(({ organizationId }) => organizationId)).toEqual(["org_a"]);
      expect(saves).toEqual([]);
      expect(report.afterOrganizationId).toBeNull();
    });
  });

  it("reads organizations a page of the organization module's limit at a time", async () => {
    const asked: unknown[] = [];
    const service = CustomerIoPlanResyncService.create({
      peers: {
        organizations: {
          listIds: async (input) => {
            asked.push(input);
            return { ids: [], next: null };
          },
        },
        catchUp: async () => ({ members: 0 }),
      },
    });

    await service.resync({
      dryRun: true,
      signal: new AbortController().signal,
      onPage: async () => {},
    });

    expect(asked).toEqual([{ after: undefined, limit: ORGANIZATION_ID_PAGE_LIMIT }]);
  });
});
