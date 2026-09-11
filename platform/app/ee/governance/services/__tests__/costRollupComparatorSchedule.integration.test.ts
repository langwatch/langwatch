// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The comparator's calendar entries, against real Postgres.
 *
 * This is the half of the wiring that was missing: the handler was registered
 * for its targetType and no `ScheduledJob` row in the fleet ever carried it,
 * so the comparator could not fire. What is asserted here is existence — a
 * governance project ends up with a row for the billed lane — plus the
 * properties that make running this on every pod safe: it does not duplicate,
 * it does not switch back on something an operator turned off, and it retires
 * the metered lane's entry that older builds minted without ever recreating it.
 *
 * Spec: specs/governance/governance-cost-rollup.feature
 * Decision: ADR-128.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Organization, Project } from "~/generated/prisma/client";
import { computeNextRunAt } from "~/server/app-layer/scheduler/nextRunAt";
import { PrismaScheduledJobRepository } from "~/server/app-layer/scheduler/scheduled-job.repository";
import { prisma } from "~/server/db";

import { GOVERNANCE_COST_SOURCE } from "../../projections/governanceCostRollup.constants";
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

function pulledTargetId() {
  return costRollupComparatorTargetId({
    tenantId: govProject.id,
    costSource: GOVERNANCE_COST_SOURCE.PULLED,
  });
}

/**
 * The row an older build minted for the metered lane. Written the way that
 * build wrote it — through the scheduler repository, active, with a real
 * forward marker — rather than by hand, so what the reconciler meets is the
 * row production actually holds.
 */
function leftoverGatewayTargetId() {
  return `${govProject.id}:${GOVERNANCE_COST_SOURCE.GATEWAY}`;
}

async function seedLeftoverGatewayEntry() {
  await scheduledJobs.upsertForTarget({
    projectId: govProject.id,
    targetType: COST_ROLLUP_COMPARATOR_TARGET_TYPE,
    targetId: leftoverGatewayTargetId(),
    cron: COST_ROLLUP_COMPARATOR_CRON,
    timezone: COST_ROLLUP_COMPARATOR_TIMEZONE,
    nextRunAt: computeNextRunAt({
      cron: COST_ROLLUP_COMPARATOR_CRON,
      timezone: COST_ROLLUP_COMPARATOR_TIMEZONE,
      after: new Date(),
    }),
  });
}

async function deleteLeftoverGatewayEntry() {
  await prisma.scheduledJob.deleteMany({
    where: {
      projectId: govProject.id,
      targetType: COST_ROLLUP_COMPARATOR_TARGET_TYPE,
      targetId: leftoverGatewayTargetId(),
    },
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

  describe("given an organization with a fresh governance project", () => {
    it("gives it one calendar entry, for the billed lane, and none for the metered lane", async () => {
      await reconcile();

      const entries = await entriesForGovProject();
      expect(entries.map((entry) => entry.targetId)).toEqual([
        pulledTargetId(),
      ]);
      const [entry] = entries;
      expect(entry!.active).toBe(true);
      expect(entry!.cron).toBe(COST_ROLLUP_COMPARATOR_CRON);
      expect(entry!.timezone).toBe(COST_ROLLUP_COMPARATOR_TIMEZONE);
      // The forward marker has to be in the future or the due-scan fires it
      // immediately and then every pass after that.
      expect(entry!.nextRunAt.getTime()).toBeGreaterThan(Date.now());
      // The handler reads the lane back out of this, so the round trip is
      // the contract that makes the entry useful rather than merely present.
      expect(costSourceFromTargetId(entry!.targetId)).toBe(
        GOVERNANCE_COST_SOURCE.PULLED,
      );
    });

    it("adds nothing on a second pass, so every pod can run it", async () => {
      // Asserted on this project's rows rather than on the returned counters:
      // the reconciler walks every governance project in the database, and the
      // integration lane shares one Postgres, so a project another suite left
      // behind moves `created` for reasons that have nothing to do with this.
      const before = await entriesForGovProject();
      await reconcile();

      const after = await entriesForGovProject();
      expect(after).toEqual(before);
      expect(after).toHaveLength(1);
    });

    it("leaves an entry an operator paused switched off", async () => {
      // Pausing is how an operator silences a noisy comparator. A reconciler
      // that treats "inactive" as "missing" undoes that on the next deploy.
      await prisma.scheduledJob.updateMany({
        where: {
          projectId: govProject.id,
          targetType: COST_ROLLUP_COMPARATOR_TARGET_TYPE,
          targetId: pulledTargetId(),
        },
        data: { active: false },
      });

      await reconcile();

      const entries = await entriesForGovProject();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.active).toBe(false);

      // Restored so the pause does not leak into the assertions below.
      await prisma.scheduledJob.updateMany({
        where: {
          projectId: govProject.id,
          targetType: COST_ROLLUP_COMPARATOR_TARGET_TYPE,
          targetId: pulledTargetId(),
        },
        data: { active: true },
      });
    });
  });

  describe("given a scheduled check of the metered lane left over from before", () => {
    /** @scenario "The nightly rollup check covers the billed lane alone" */
    it("marks it inactive at start, keeps it inactive on a later start, and leaves the billed check active", async () => {
      await seedLeftoverGatewayEntry();
      const seeded = await entriesForGovProject();
      // Self-check: the leftover really is live before the boot step runs, or
      // "marked inactive" below would be asserting against a row that was
      // never switched on.
      expect(
        seeded.find((entry) => entry.targetId === leftoverGatewayTargetId())
          ?.active,
      ).toBe(true);

      await reconcile();

      const afterFirstStart = await entriesForGovProject();
      expect(
        afterFirstStart.find(
          (entry) => entry.targetId === leftoverGatewayTargetId(),
        )?.active,
      ).toBe(false);
      expect(
        afterFirstStart.find((entry) => entry.targetId === pulledTargetId())
          ?.active,
      ).toBe(true);

      await reconcile();

      const afterLaterStart = await entriesForGovProject();
      // Still there, still off: retired rather than deleted, so an operator
      // can see what the older build had scheduled, and never recreated.
      expect(
        afterLaterStart.filter(
          (entry) => entry.targetId === leftoverGatewayTargetId(),
        ),
      ).toHaveLength(1);
      expect(
        afterLaterStart.find(
          (entry) => entry.targetId === leftoverGatewayTargetId(),
        )?.active,
      ).toBe(false);
      expect(
        afterLaterStart.find((entry) => entry.targetId === pulledTargetId())
          ?.active,
      ).toBe(true);

      await deleteLeftoverGatewayEntry();
    });

    it("leaves a metered check that is already inactive exactly as it is", async () => {
      await seedLeftoverGatewayEntry();
      await prisma.scheduledJob.updateMany({
        where: {
          projectId: govProject.id,
          targetType: COST_ROLLUP_COMPARATOR_TARGET_TYPE,
          targetId: leftoverGatewayTargetId(),
        },
        data: { active: false },
      });
      const before = await entriesForGovProject();

      await reconcile();

      // Byte-for-byte the same rows: an inactive leftover is not switched off
      // again (no write, no bumped `updatedAt`) and not recreated.
      expect(await entriesForGovProject()).toEqual(before);

      await deleteLeftoverGatewayEntry();
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

      await reconcile();

      const entries = await entriesForGovProject();
      expect(entries.length).toBeGreaterThan(0);
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
          costSource: GOVERNANCE_COST_SOURCE.PULLED,
        }),
      ),
    ).toBe(GOVERNANCE_COST_SOURCE.PULLED);
  });

  it("returns null for a lane we do not have", () => {
    // Rather than guessing: comparing the wrong lane would report drift
    // between two things never meant to match.
    expect(costSourceFromTargetId("proj_abc:seats")).toBeNull();
  });

  /** @scenario "A leftover metered check that fires anyway settles quietly" */
  it("names no lane for a metered check, which is what lets the handler settle it without comparing", () => {
    // A leftover row can fire in the window between the loop's due-scan and
    // the boot step that retires it. The handler answers a null lane by
    // logging and returning — delivered, not thrown — so the slot is not
    // retried. That null is the whole mechanism, and this pins it.
    expect(
      costSourceFromTargetId(`proj_abc:${GOVERNANCE_COST_SOURCE.GATEWAY}`),
    ).toBeNull();
  });
});
