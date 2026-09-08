/**
 * @vitest-environment node
 * The two entitlement readers' contract, stated once and run against every
 * backend the package can reach. The memory twins run always; a Postgres
 * backend joins the table when this package declares a datastore in its vitest
 * config. Both interfaces are small, so one file holds both.
 * @see specs/usage-stats-reporting.feature
 */
import type { ProjectSpendRollup } from "@langwatch/entitlement-contract";
import { describe, expect, it } from "vitest";

import type { EntitlementRepositories } from "../entitlement.repositories.ts";
import {
  MemoryEntitlementDatabase,
  type MemoryOrganizationUsage,
} from "../memory/memory.entitlement.database.ts";
import { MemoryOrganizationSpendRepository } from "../memory/memory.organization-spend.repository.ts";
import { MemoryUsageMembershipRepository } from "../memory/memory.usage-membership.repository.ts";

const ACME = "org_acme";
const OTHER = "org_other";
const OLIVE = "user_olive";
const PAT = "user_pat";

/** What a backend must be able to record before the cases can read it back. */
type UsageSeed = MemoryOrganizationUsage;

type Backend = Readonly<{
  name: string;
  create: (seeds: readonly UsageSeed[]) => EntitlementRepositories;
}>;

const backends: readonly Backend[] = [
  {
    name: "memory",
    create: (seeds) => {
      const database = MemoryEntitlementDatabase.create();
      for (const seed of seeds) database.put(seed);

      return {
        membership: MemoryUsageMembershipRepository.create({ memory: database }),
        spend: MemoryOrganizationSpendRepository.create({ memory: database }),
      };
    },
  },
];

function rollup(projectId: string, amount: number): ProjectSpendRollup {
  return {
    project: { id: projectId },
    costs: [
      {
        projectId,
        costType: "trace",
        currency: "USD",
        _sum: { amount },
        _count: { id: 1 },
      },
    ],
  };
}

const ACME_USAGE: UsageSeed = {
  organizationId: ACME,
  memberCount: 3,
  membersLiteCount: 2,
  currentMonthCost: 42,
  projectCosts: { project_1: 30, project_2: 12 },
  spendByUserId: { [OLIVE]: [rollup("project_1", 30)] },
};

const OTHER_USAGE: UsageSeed = {
  organizationId: OTHER,
  memberCount: 9,
  membersLiteCount: 9,
  currentMonthCost: 900,
  projectCosts: { project_9: 900 },
  spendByUserId: { [OLIVE]: [rollup("project_9", 900)] },
};

const WINDOW = { startDate: 0, endDate: 1 };

describe.each(backends)("given the $name entitlement repositories", ({ create }) => {
  describe("when the organization has no rows at all", () => {
    /** @scenario "The memory and Postgres entitlement repositories answer alike" */
    it("counts no members of either kind", async () => {
      const { membership } = create([]);

      await expect(membership.getMemberCount(ACME)).resolves.toBe(0);
      await expect(membership.getMembersLiteCount(ACME)).resolves.toBe(0);
    });

    it("reports nothing spent this month", async () => {
      const { membership } = create([]);

      await expect(membership.getCurrentMonthCost(ACME)).resolves.toBe(0);
      await expect(membership.getCurrentMonthCostForProjects(["project_1"])).resolves.toBe(0);
    });

    it("rolls up no spend for the caller", async () => {
      const { spend } = create([]);

      await expect(
        spend.findSpendRollups({ organizationId: ACME, userId: OLIVE, ...WINDOW }),
      ).resolves.toEqual([]);
    });
  });

  describe("when the organization has members and spend", () => {
    it("counts full members and lite members apart", async () => {
      const { membership } = create([ACME_USAGE]);

      await expect(membership.getMemberCount(ACME)).resolves.toBe(3);
      await expect(membership.getMembersLiteCount(ACME)).resolves.toBe(2);
    });

    it("reports the month's spend for the organization", async () => {
      const { membership } = create([ACME_USAGE]);

      await expect(membership.getCurrentMonthCost(ACME)).resolves.toBe(42);
    });

    it("sums only the projects the caller named", async () => {
      const { membership } = create([ACME_USAGE]);

      await expect(membership.getCurrentMonthCostForProjects(["project_1"])).resolves.toBe(30);
      await expect(
        membership.getCurrentMonthCostForProjects(["project_1", "project_2"]),
      ).resolves.toBe(42);
      await expect(membership.getCurrentMonthCostForProjects([])).resolves.toBe(0);
    });

    it("rolls the spend up per project for the person who may see it", async () => {
      const { spend } = create([ACME_USAGE]);

      await expect(
        spend.findSpendRollups({ organizationId: ACME, userId: OLIVE, ...WINDOW }),
      ).resolves.toEqual([rollup("project_1", 30)]);
    });

    it("answers nothing for a person no project was recorded for", async () => {
      const { spend } = create([ACME_USAGE]);

      await expect(
        spend.findSpendRollups({ organizationId: ACME, userId: PAT, ...WINDOW }),
      ).resolves.toEqual([]);
    });
  });

  describe("when another organization holds rows of its own", () => {
    it("never counts the other organization's members", async () => {
      const { membership } = create([ACME_USAGE, OTHER_USAGE]);

      await expect(membership.getMemberCount(ACME)).resolves.toBe(3);
      await expect(membership.getMembersLiteCount(ACME)).resolves.toBe(2);
      await expect(membership.getCurrentMonthCost(ACME)).resolves.toBe(42);
    });

    it("never counts a project the caller did not name", async () => {
      const { membership } = create([ACME_USAGE, OTHER_USAGE]);

      await expect(
        membership.getCurrentMonthCostForProjects(["project_1", "project_2"]),
      ).resolves.toBe(42);
    });

    it("never rolls up the other organization's spend", async () => {
      const { spend } = create([ACME_USAGE, OTHER_USAGE]);

      await expect(
        spend.findSpendRollups({ organizationId: ACME, userId: OLIVE, ...WINDOW }),
      ).resolves.toEqual([rollup("project_1", 30)]);
    });
  });
});
