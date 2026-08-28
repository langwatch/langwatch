// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The comparator's calendar entries, against real Postgres.
 *
 * This is the half of the wiring that was missing: the handler was registered
 * for its targetType and no `ScheduledJob` row in the fleet ever carried it,
 * so the comparator could not fire. What is asserted here is existence — a
 * governance project ends up with a row per lane — plus the two properties
 * that make running this on every pod safe: it does not duplicate, and it does
 * not switch back on something an operator turned off.
 *
 * Decision: ADR-128.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Organization, Project } from "~/generated/prisma/client";
import { PrismaScheduledJobRepository } from "~/server/app-layer/scheduler/scheduled-job.repository";
import { prisma } from "~/server/db";

import { COST_ROLLUP_COMPARATOR_TARGET_TYPE } from "../costRollupComparator.service";
import {
  COST_ROLLUP_COMPARATOR_CRON,
  COST_ROLLUP_COMPARATOR_TIMEZONE,
  costRollupComparatorTargetId,
  costSourceFromTargetId,
  reconcileCostRollupComparatorSchedules,
} from "../costRollupComparatorSchedule";
import { ensureHiddenGovernanceProject } from "../governanceProject.service";

const namespace = `cost-comparator-sched-${nanoid(8)}`;

/** Swallowed so a failing tenant is counted, not thrown — asserted below. */
const silentLogger = { warn: () => undefined };

let org: Organization;
let govProject: Project;
let scheduledJobs: PrismaScheduledJobRepository;

async function reconcile() {
  return reconcileCostRollupComparatorSchedules({
    prisma,
    scheduledJobs,
    targetType: COST_ROLLUP_COMPARATOR_TARGET_TYPE,
    logger: silentLogger,
  });
}

async function entriesForGovProject() {
  return prisma.scheduledJob.findMany({
    where: {
      projectId: govProject.id,
      targetType: COST_ROLLUP_COMPARATOR_TARGET_TYPE,
    },
    orderBy: { targetId: "asc" },
  });
}

describe("cost rollup comparator schedules", () => {
  beforeAll(async () => {
    scheduledJobs = new PrismaScheduledJobRepository(prisma);
    org = await prisma.organization.create({
      data: { name: `Comparator Org ${namespace}`, slug: `org-${namespace}` },
    });
    await prisma.team.create({
      data: {
        name: `Comparator Team ${namespace}`,
        slug: `team-${namespace}`,
        organizationId: org.id,
      },
    });
    govProject = await ensureHiddenGovernanceProject(prisma, org.id);
  });

  afterAll(async () => {
    await prisma.scheduledJob
      .deleteMany({ where: { projectId: govProject.id } })
      .catch(() => undefined);
    await prisma.project
      .deleteMany({ where: { id: govProject.id } })
      .catch(() => undefined);
    await prisma.team
      .deleteMany({ where: { organizationId: org.id } })
      .catch(() => undefined);
    await prisma.organization
      .deleteMany({ where: { id: org.id } })
      .catch(() => undefined);
  });

  describe("given an organization with a governance project", () => {
    it("gives it one calendar entry per cost source", async () => {
      await reconcile();

      const entries = await entriesForGovProject();
      expect(entries.map((entry) => entry.targetId)).toEqual([
        costRollupComparatorTargetId({
          tenantId: govProject.id,
          costSource: "gateway",
        }),
        costRollupComparatorTargetId({
          tenantId: govProject.id,
          costSource: "pulled",
        }),
      ]);
      for (const entry of entries) {
        expect(entry.active).toBe(true);
        expect(entry.cron).toBe(COST_ROLLUP_COMPARATOR_CRON);
        expect(entry.timezone).toBe(COST_ROLLUP_COMPARATOR_TIMEZONE);
        // The forward marker has to be in the future or the due-scan fires it
        // immediately and then every pass after that.
        expect(entry.nextRunAt.getTime()).toBeGreaterThan(Date.now());
        // The handler reads the lane back out of this, so the round trip is
        // the contract that makes the entry useful rather than merely present.
        expect(costSourceFromTargetId(entry.targetId)).not.toBeNull();
      }
    });

    it("adds nothing on a second pass, so every pod can run it", async () => {
      const result = await reconcile();

      expect(result.created).toBe(0);
      expect(result.failed).toBe(0);
      expect(await entriesForGovProject()).toHaveLength(2);
    });

    it("leaves an entry an operator paused switched off", async () => {
      // Pausing is how an operator silences a noisy comparator. A reconciler
      // that treats "inactive" as "missing" undoes that on the next deploy.
      await prisma.scheduledJob.updateMany({
        where: {
          projectId: govProject.id,
          targetType: COST_ROLLUP_COMPARATOR_TARGET_TYPE,
          targetId: costRollupComparatorTargetId({
            tenantId: govProject.id,
            costSource: "gateway",
          }),
        },
        data: { active: false },
      });

      const result = await reconcile();

      expect(result.created).toBe(0);
      const entries = await entriesForGovProject();
      expect(entries.find((e) => e.targetId.endsWith(":gateway"))?.active).toBe(
        false,
      );
      expect(entries.find((e) => e.targetId.endsWith(":pulled"))?.active).toBe(
        true,
      );
    });
  });

  describe("given the governance project was archived", () => {
    it("switches its entries off rather than firing at a dead tenant", async () => {
      await prisma.scheduledJob.updateMany({
        where: {
          projectId: govProject.id,
          targetType: COST_ROLLUP_COMPARATOR_TARGET_TYPE,
        },
        data: { active: true },
      });
      await prisma.project.update({
        where: { id: govProject.id },
        data: { archivedAt: new Date() },
      });

      const result = await reconcile();

      expect(result.deactivated).toBe(2);
      const entries = await entriesForGovProject();
      expect(entries.every((entry) => entry.active)).toBe(false);

      // Restored so the archived state does not leak into other assertions.
      await prisma.project.update({
        where: { id: govProject.id },
        data: { archivedAt: null },
      });
    });
  });
});

describe("costSourceFromTargetId", () => {
  it("reads the lane back out of a target id", () => {
    expect(
      costSourceFromTargetId(
        costRollupComparatorTargetId({
          tenantId: "proj_abc",
          costSource: "pulled",
        }),
      ),
    ).toBe("pulled");
  });

  it("returns null for a lane we do not have", () => {
    // Rather than guessing: comparing the wrong lane would report drift
    // between two things never meant to match.
    expect(costSourceFromTargetId("proj_abc:seats")).toBeNull();
  });
});
