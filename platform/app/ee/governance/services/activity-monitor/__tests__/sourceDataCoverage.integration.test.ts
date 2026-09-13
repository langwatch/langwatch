// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * What a day looks like when nobody successfully pulled it.
 *
 * A dead puller and a quiet week produce the same empty result set, and the
 * dense-bucket chart turns both into a run of zeroes -- so the screen tells
 * an admin their spend collapsed on exactly the days we stopped being able
 * to measure it. Coverage is the fact that separates them: a day the last
 * successful pull never reached has unknown spend, and unknown must never be
 * rendered as a number.
 *
 * Real Postgres, because the source row -- its error count and its last
 * successful pull -- is the input the whole answer turns on.
 *
 * Spec: specs/governance/ingestion-source-health.feature
 * Decision: ADR-128.
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Organization, Team } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { ActivityMonitorService } from "../activityMonitor.service";

const ns = `coverage-${nanoid(8)}`;
const DAY_MS = 24 * 60 * 60 * 1000;

let organization: Organization;
let team: Team;
let sourceId: string;
/** The last run that worked. Everything after this is unknown, not zero. */
let lastSuccessAt: Date;
/**
 * The teardown's own handle on what setup created.
 *
 * `afterAll` runs even when `beforeAll` threw partway, and reading `.id` off a
 * fixture that was never assigned raises a TypeError there — which is the
 * error the report shows, in place of the setup failure that actually broke
 * the run.
 */
let createdOrganizationId: string | undefined;

beforeAll(async () => {
  organization = await prisma.organization.create({
    data: { name: `Coverage ${ns}`, slug: `--test-org-${ns}` },
  });
  createdOrganizationId = organization.id;
  team = await prisma.team.create({
    data: {
      name: `Coverage ${ns}`,
      slug: `--test-team-${ns}`,
      organizationId: organization.id,
    },
  });

  // Four days ago, then three failed runs in a row: unhealthy, and silent
  // ever since.
  lastSuccessAt = new Date(Date.now() - 4 * DAY_MS);
  const source = await prisma.ingestionSource.create({
    data: {
      organizationId: organization.id,
      teamId: team.id,
      sourceType: "anthropic_admin",
      name: `Coverage ${ns}`,
      ingestSecretHash: `hash-${ns}`,
      pullSchedule: "*/15 * * * *",
      errorCount: 3,
      lastSuccessAt,
      status: "active",
    },
  });
  sourceId = source.id;
});

afterAll(async () => {
  const organizationId = createdOrganizationId;
  if (!organizationId) return;

  // Not swallowed: a delete that fails leaves rows behind for every later run
  // against this database, and a silent teardown is how that goes unnoticed
  // until an unrelated suite starts failing.
  await prisma.ingestionSource.deleteMany({ where: { organizationId } });
  await prisma.project.deleteMany({ where: { team: { organizationId } } });
  await prisma.team.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } });
});

describe("given a source that has been unhealthy since its last successful pull", () => {
  describe("when a viewer looks at a day after that last successful pull", () => {
    /** @scenario "A day with no data is shown as unknown, never as zero" */
    it("reports the day as uncovered with no spend figure at all", async () => {
      const service = ActivityMonitorService.create({ prisma });

      const coverage = await service.sourceDataCoverage({
        organizationId: organization.id,
        sourceId,
        windowDays: 7,
      });

      expect(coverage.health).toBe("unhealthy");
      expect(coverage.consecutiveFailures).toBe(3);
      expect(coverage.lastSuccessfulPullIso).toBe(lastSuccessAt.toISOString());

      const dayAfter = coverage.days.find(
        (day) => Date.parse(day.dayStartIso) > lastSuccessAt.getTime(),
      );
      expect(dayAfter).toBeDefined();
      // Uncovered: the screen has nothing to show for this day but the
      // "no data since" notice.
      expect(dayAfter?.covered).toBe(false);
      // And the shape offers no number to round down to zero.
      expect(dayAfter).not.toHaveProperty("spendUsd");

      const everyLaterDayIsUnknown = coverage.days
        .filter((day) => Date.parse(day.dayStartIso) > lastSuccessAt.getTime())
        .every((day) => !day.covered);
      expect(everyLaterDayIsUnknown).toBe(true);
    });

    it("still covers the days the last successful pull reached", async () => {
      const service = ActivityMonitorService.create({ prisma });

      const coverage = await service.sourceDataCoverage({
        organizationId: organization.id,
        sourceId,
        windowDays: 7,
      });

      // Guard the guard: an all-uncovered window would satisfy the assertion
      // above for the wrong reason.
      const covered = coverage.days.filter((day) => day.covered);
      expect(covered.length).toBeGreaterThan(0);
      for (const day of covered) {
        expect(Date.parse(day.dayStartIso)).toBeLessThanOrEqual(
          lastSuccessAt.getTime(),
        );
      }
    });
  });
});

describe("given a source whose runs are succeeding", () => {
  describe("when a viewer looks at the window", () => {
    it("reads as healthy", async () => {
      const healthy = await prisma.ingestionSource.create({
        data: {
          organizationId: organization.id,
          teamId: team.id,
          sourceType: "anthropic_admin",
          name: `Coverage healthy ${ns}`,
          ingestSecretHash: `hash-healthy-${ns}`,
          pullSchedule: "*/15 * * * *",
          errorCount: 1,
          lastSuccessAt: new Date(),
          status: "active",
        },
      });
      const service = ActivityMonitorService.create({ prisma });

      const coverage = await service.sourceDataCoverage({
        organizationId: organization.id,
        sourceId: healthy.id,
        windowDays: 7,
      });

      expect(coverage.health).toBe("healthy");
      expect(coverage.days.every((day) => day.covered)).toBe(true);
    });
  });
});
