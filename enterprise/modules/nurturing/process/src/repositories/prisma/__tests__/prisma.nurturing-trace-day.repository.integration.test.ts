// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Nurturing's trace days in Postgres: the two trace-day folds' rows, one per project, UTC day and
 * source, folded as live delivery folds them, read summed and pruned.
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
 */
import { randomUUID } from "node:crypto";

import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import { createTenantId } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { createTestLogger } from "@langwatch/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  foldLive,
  spanReceived,
  traceFailed,
} from "../../../eventing/__tests__/nurturing-trace-days.test-helpers.ts";
import { traceCountsOf, traceDayKeyOf } from "../../../rules/nurturing-trace-day.rules.ts";
import { NurturingCopiedProjectsService } from "../../../services/nurturing-copied-projects.service.ts";
import { NurturingOrganizationUsageService } from "../../../services/nurturing-organization-usage.service.ts";
import { MemoryNurturingErasedUserRepository } from "../../memory/memory.nurturing-erased-user.repository.ts";
import { MemoryNurturingEvaluationDayRepository } from "../../memory/memory.nurturing-evaluation-day.repository.ts";
import { MemoryNurturingMilestonesRepository } from "../../memory/memory.nurturing-milestones.repository.ts";
import { MemoryNurturingOrganizationMemberRepository } from "../../memory/memory.nurturing-organization-member.repository.ts";
import { MemoryNurturingProjectUsageRepository } from "../../memory/memory.nurturing-project-usage.repository.ts";
import { MemoryNurturingClaimRepository } from "../../memory/memory.nurturing.repositories.ts";
import { NURTURING_TRACE_DAY_PROJECTION_VERSION } from "../../nurturing-trace-day.repository.ts";
import { PrismaNurturingOrganizationCreatedRepository } from "../prisma.nurturing-organization-created.repository.ts";
import { PrismaNurturingProjectPlacementRepository } from "../prisma.nurturing-project-placement.repository.ts";
import { PrismaNurturingTraceDayRepository } from "../prisma.nurturing-trace-day.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-nurturing-trace-day-${randomUUID()}`;
const projectId = `${namespace}-project`;
const otherProjectId = `${namespace}-other`;
const uncopiedProjectId = `${namespace}-uncopied`;
const quietProjectId = `${namespace}-quiet`;
const organizationId = `${namespace}-org`;
const projectIds = [projectId, otherProjectId, uncopiedProjectId, quietProjectId];
const NOON = Date.UTC(2026, 11, 2, 12);
const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(!databaseUrl)("given nurturing's trace-day rows in Postgres", () => {
  let connection: PrismaConnection;
  let repository: PrismaNurturingTraceDayRepository;

  beforeAll(() => {
    if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:nurturing:test:trace-day"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    repository = PrismaNurturingTraceDayRepository.create({ prisma: connection.client });
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.client.nurturingProjectTraceDayCount.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    await connection.client.nurturingProject.deleteMany({
      where: { projectId: uncopiedProjectId },
    });
    await connection.client.nurturingOrganizationCreated.deleteMany({
      where: { organizationId },
    });
    await connection.closeOnce();
  });

  const fold = (facts: Parameters<typeof foldLive>[0]["facts"]) =>
    foldLive({
      spans: repository.forSource("spans"),
      failures: repository.forSource("failures"),
      facts,
    });

  describe("when root spans and failures of one project and day are folded", () => {
    /** @scenario "A trace is its root span, counted on its project's day" */
    it("keeps a spans row and a failures row of the day, which the read sums", async () => {
      await fold([
        spanReceived({ id: `${namespace}-s1`, projectId, createdAt: NOON }),
        traceFailed({ id: `${namespace}-s1`, projectId, createdAt: NOON + 500 }),
        spanReceived({ id: `${namespace}-s2`, projectId, createdAt: NOON + 1000 }),
        spanReceived({ id: `${namespace}-s3`, projectId, createdAt: NOON + DAY_MS }),
      ]);

      const rows = await connection.client.nurturingProjectTraceDayCount.findMany({
        where: { projectId },
        orderBy: [{ day: "asc" }, { source: "asc" }],
      });
      expect(
        rows.map(({ day, source, traceCount, errorCount }) => [
          day,
          source,
          traceCount,
          errorCount,
        ]),
      ).toEqual([
        ["2026-12-02", "failures", 0, 1],
        ["2026-12-02", "spans", 2, 0],
        ["2026-12-03", "spans", 1, 0],
      ]);
      expect(
        rows.every((row) => row.projectionVersion === NURTURING_TRACE_DAY_PROJECTION_VERSION),
      ).toBe(true);
      const days = await repository.findForProjects({ projectIds: [projectId], afterDay: "" });
      expect(traceCountsOf({ days, windowStartDay: "" })).toEqual({
        traceCount: 3,
        errorCount: 1,
        lastTraceAt: NOON + DAY_MS,
        lastFailedTraceAt: NOON + 500,
        activeDays: ["2026-12-02", "2026-12-03"],
      });
    });

    /** @scenario "The spans and failures folds keep their own rows of a day, which the read sums" */
    it("stores each source's applied event ids, and one fold's write leaves the other's row", async () => {
      const key = traceDayKeyOf({ projectId: otherProjectId, day: "2026-12-02" });
      const context = { aggregateId: key, tenantId: createTenantId(otherProjectId), key };
      const day = { projectId: otherProjectId, day: "2026-12-02", lastFailedTraceAt: null };
      await repository.forSource("spans").store(
        { ...day, traceCount: 4, errorCount: 0, lastTraceAt: NOON },
        {
          ...context,
          appliedEventIds: ["span-event"],
        },
      );
      await repository.forSource("failures").store(
        { ...day, traceCount: 0, errorCount: 1, lastTraceAt: null, lastFailedTraceAt: NOON },
        {
          ...context,
          appliedEventIds: ["failed-event"],
        },
      );

      await expect(repository.forSource("spans").getWithApplied?.(key, context)).resolves.toEqual({
        state: { ...day, traceCount: 4, errorCount: 0, lastTraceAt: NOON },
        appliedEventIds: ["span-event"],
      });
      await expect(
        repository.forSource("failures").getWithApplied?.(key, context),
      ).resolves.toMatchObject({ appliedEventIds: ["failed-event"], state: { errorCount: 1 } });
    });
  });

  describe("when a project traces before nurturing copied its placement", () => {
    /** @scenario "A trace of a project with no placement copy yet is counted, and syncs once the copy lands" */
    it("counts the trace at once, and sends it in the organization's traits once the copies land", async () => {
      const placements = PrismaNurturingProjectPlacementRepository.create({
        prisma: connection.client,
      });
      const organizationsCreated = PrismaNurturingOrganizationCreatedRepository.create({
        prisma: connection.client,
      });
      const milestones = MemoryNurturingMilestonesRepository.create();
      await milestones.recordOrganization({
        organizationId,
        adminUserId: "admin-1",
        seeded: false,
      });
      const sent: CioBatchCall[] = [];
      const usage = NurturingOrganizationUsageService.create({
        projectUsage: MemoryNurturingProjectUsageRepository.create(),
        traceDays: repository,
        evaluationDays: MemoryNurturingEvaluationDayRepository.create(),
        copiedProjects: NurturingCopiedProjectsService.create({ placements, organizationsCreated }),
        placements,
        organizationsCreated,
        milestones,
        members: MemoryNurturingOrganizationMemberRepository.create(),
        erasedUsers: MemoryNurturingErasedUserRepository.create(),
        claims: MemoryNurturingClaimRepository.create(),
        sendBatch: async (calls) => void sent.push(...calls),
        clock: { nowMs: () => NOON + 60_000 },
        logger: createTestLogger().logger,
        syncs: { inc: () => {} },
      });

      await fold([
        spanReceived({ id: `${namespace}-u1`, projectId: uncopiedProjectId, createdAt: NOON }),
      ]);
      await usage.tracesChanged({ projectId: uncopiedProjectId });
      expect(sent).toEqual([]);

      await placements.recordProject({ projectId: uncopiedProjectId, organizationId });
      await organizationsCreated.recordOrganizationCreated({
        organizationId,
        createdAt: NOON - DAY_MS,
      });
      await usage.tracesChanged({ projectId: uncopiedProjectId });

      expect(sent).toEqual([
        expect.objectContaining({
          type: "group",
          groupId: organizationId,
          traits: expect.objectContaining({ trace_count: 1 }),
        }),
      ]);
    });
  });

  describe("when trace days are pruned", () => {
    /** @scenario "Trace days older than the window are deleted" */
    it("deletes the projects' days before the window's start, and keeps the later ones", async () => {
      await fold([
        spanReceived({ id: `${namespace}-old`, projectId, createdAt: NOON - 60 * DAY_MS }),
      ]);

      await repository.pruneBefore({ projectIds: [projectId], beforeDay: "2026-11-01" });

      const kept = await repository.findForProjects({ projectIds: [projectId], afterDay: "" });
      expect(kept.map(({ day }) => day).toSorted()).toEqual([
        "2026-12-02",
        "2026-12-02",
        "2026-12-03",
      ]);
    });

    /** @scenario "The hourly sweep drops every trace day older than the usage window" */
    it("deletes every project's old days, those of a project that never synced included", async () => {
      await fold([
        spanReceived({
          id: `${namespace}-q1`,
          projectId: quietProjectId,
          createdAt: NOON - 40 * DAY_MS,
        }),
        spanReceived({
          id: `${namespace}-q2`,
          projectId: quietProjectId,
          createdAt: NOON - DAY_MS,
        }),
      ]);

      await repository.pruneEveryProjectBefore({ beforeDay: "2026-11-02" });

      const kept = await repository.findForProjects({ projectIds: [quietProjectId], afterDay: "" });
      expect(kept.map(({ day }) => day)).toEqual(["2026-12-01"]);
    });

    /** @scenario "The trace traits are removed once when an organization's window ends" */
    it("drops every day of a project whose window ended, and none of another's", async () => {
      await repository.pruneProjects({ projectIds: [quietProjectId] });

      await expect(
        repository.findForProjects({ projectIds: [quietProjectId], afterDay: "" }),
      ).resolves.toEqual([]);
      const other = await repository.findForProjects({ projectIds: [projectId], afterDay: "" });
      expect(other.length).toBeGreaterThan(0);
    });
  });
});
