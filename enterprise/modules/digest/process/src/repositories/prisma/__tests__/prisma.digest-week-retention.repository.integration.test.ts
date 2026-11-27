// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Sweep old digest weeks, in Postgres: each week table drops every organization's weeks older
 * than the cutoff, keeps the cutoff week and later ones untouched, and leaves the other table
 * and the send rows alone.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import { randomUUID } from "node:crypto";

import { createTenantId } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  type PrismaConnection,
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { emptyProjectWeek, emptyUserWeek } from "../../../rules/digest-week.rules.ts";
import { PrismaDigestProjectWeekRepository } from "../prisma.digest-project-week.repository.ts";
import { PrismaDigestSendRepository } from "../prisma.digest-send.repository.ts";
import { PrismaDigestUserWeekRepository } from "../prisma.digest-user-week.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const run = randomUUID();
const organizationIds = [`test-digest-retention-a-${run}`, `test-digest-retention-b-${run}`];
// Years no real week reaches, so the sweep, which spans every organization, takes only these rows.
const BEFORE = "2001-W19";
const CUTOFF = "2001-W20";
const AFTER = "2001-W21";
const SENT_WEEK = "2001-W22";
const AT = Date.parse("2001-05-14T12:00:00Z");
// Each row's traces and sessions carry its week, so "unchanged" is read off the value.
const TRACES_OF: Record<string, number> = { [BEFORE]: 1, [CUTOFF]: 2, [AFTER]: 3 };

describe.skipIf(!databaseUrl)("given digest weeks around a cutoff in two organizations", () => {
  let connection: PrismaConnection;
  let projectWeeks: PrismaDigestProjectWeekRepository;
  let userWeeks: PrismaDigestUserWeekRepository;
  let sends: PrismaDigestSendRepository;

  const projectIdOf = (organizationId: string) => `project-of-${organizationId}`;
  const userIdOf = (organizationId: string) => `user-of-${organizationId}`;

  const projection = <State>(state: State, key: string) => ({
    state,
    cursor: { eventId: `event-${key}`, acceptedAt: AT },
    occurredAt: AT,
    createdAt: AT,
    updatedAt: AT,
    version: "test",
  });

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:digest:test:week-retention"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    projectWeeks = PrismaDigestProjectWeekRepository.create({ prisma: connection.client });
    userWeeks = PrismaDigestUserWeekRepository.create({ prisma: connection.client });
    sends = PrismaDigestSendRepository.create({ prisma: connection.client });

    for (const organizationId of organizationIds) {
      const projectId = projectIdOf(organizationId);
      const userId = userIdOf(organizationId);
      const tenantId = createTenantId(organizationId);
      for (const [isoWeek, traces] of Object.entries(TRACES_OF)) {
        const key = `${organizationId}:${isoWeek}`;
        await projectWeeks.store(
          projection({ ...emptyProjectWeek(), projectId, organizationId, isoWeek, traces }, key),
          { aggregateId: key, key, tenantId },
        );
        await userWeeks.store(
          projection(
            { ...emptyUserWeek(), userId, organizationId, isoWeek, sessionOverflow: traces },
            key,
          ),
          { aggregateId: key, key, tenantId },
        );
      }
      // Not a week fold: the simplest other digest row this harness creates per organization.
      await sends.claim({
        userId,
        organizationId,
        isoWeek: SENT_WEEK,
        templateId: "digest-coding-agent-week",
        sentAt: AT,
      });
    }
  });

  afterAll(async () => {
    if (!connection) return;
    for (const organizationId of organizationIds) {
      await connection.client.digestSend.deleteMany({ where: { organizationId } });
      await connection.client.digestProjectWeek.deleteMany({ where: { organizationId } });
      await connection.client.digestUserWeek.deleteMany({ where: { organizationId } });
    }
    await connection.closeOnce();
  });

  const projectWeeksIn = async (organizationId: string) =>
    Object.fromEntries(
      (await projectWeeks.findWeeks({ isoWeeks: [BEFORE, CUTOFF, AFTER], organizationId })).map(
        ({ isoWeek, traces }) => [isoWeek, traces],
      ),
    );
  const userWeeksIn = async (organizationId: string) =>
    Object.fromEntries(
      (await userWeeks.findWeeks({ isoWeeks: [BEFORE, CUTOFF, AFTER], organizationId })).map(
        ({ isoWeek, sessionOverflow }) => [isoWeek, sessionOverflow],
      ),
    );
  /** What the two organizations hold in each table, week by week, and how many rows. */
  const snapshot = async () => {
    const where = { organizationId: { in: organizationIds } };
    return {
      projectWeeks: await Promise.all(organizationIds.map(projectWeeksIn)),
      userWeeks: await Promise.all(organizationIds.map(userWeeksIn)),
      counts: {
        projectWeeks: await connection.client.digestProjectWeek.count({ where }),
        userWeeks: await connection.client.digestUserWeek.count({ where }),
        sends: await connection.client.digestSend.count({ where }),
      },
    };
  };

  const everyWeek = TRACES_OF;
  const fromCutoff = { [CUTOFF]: TRACES_OF[CUTOFF], [AFTER]: TRACES_OF[AFTER] };
  const seededRows = organizationIds.length * Object.keys(TRACES_OF).length;
  const oldRows = organizationIds.length;

  describe("when each week table is swept once before the cutoff", () => {
    let seeded: Awaited<ReturnType<typeof snapshot>>;
    let afterProjectSweep: Awaited<ReturnType<typeof snapshot>>;
    let afterBothSweeps: Awaited<ReturnType<typeof snapshot>>;

    beforeAll(async () => {
      seeded = await snapshot();
      await projectWeeks.deleteBefore({ isoWeek: CUTOFF });
      afterProjectSweep = await snapshot();
      await userWeeks.deleteBefore({ isoWeek: CUTOFF });
      afterBothSweeps = await snapshot();
    });

    it("starts with every week in both organizations", () => {
      expect(seeded.projectWeeks).toEqual([everyWeek, everyWeek]);
      expect(seeded.userWeeks).toEqual([everyWeek, everyWeek]);
    });

    /** @scenario "Weeks older than the sent week's baseline are swept" */
    it("drops the weeks before the cutoff in both organizations", () => {
      for (const weeks of afterBothSweeps.projectWeeks) expect(weeks).not.toHaveProperty(BEFORE);
      for (const weeks of afterBothSweeps.userWeeks) expect(weeks).not.toHaveProperty(BEFORE);
    });

    /** @scenario "Weeks older than the sent week's baseline are swept" */
    it("keeps the cutoff week and later weeks in both organizations with their values", () => {
      expect(afterBothSweeps.projectWeeks).toEqual([fromCutoff, fromCutoff]);
      expect(afterBothSweeps.userWeeks).toEqual([fromCutoff, fromCutoff]);
    });

    it("leaves the other week table untouched when one table is swept", () => {
      expect(afterProjectSweep.projectWeeks).toEqual([fromCutoff, fromCutoff]);
      expect(afterProjectSweep.userWeeks).toEqual(seeded.userWeeks);
      expect(afterProjectSweep.counts.userWeeks).toBe(seeded.counts.userWeeks);
    });

    it("removes exactly the old rows and keeps the send rows", () => {
      expect(seeded.counts).toEqual({
        projectWeeks: seededRows,
        userWeeks: seededRows,
        sends: organizationIds.length,
      });
      expect(afterBothSweeps.counts).toEqual({
        projectWeeks: seededRows - oldRows,
        userWeeks: seededRows - oldRows,
        sends: organizationIds.length,
      });
    });
  });
});
