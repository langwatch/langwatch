// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Nurturing's own trace counts, one row per project and UTC day.
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
 */
import { randomUUID } from "node:crypto";

import { createTenantId } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  emptyTraceDay,
  type NurturingTraceDayState,
} from "../../../rules/nurturing-trace-day.rules.ts";
import { traceDayKey } from "../../nurturing-trace-day.repository.ts";
import { PrismaNurturingTraceDayRepository } from "../prisma.nurturing-trace-day.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-nurturing-trace-day-${randomUUID()}`;
const projectId = `${namespace}-project`;
const otherProjectId = `${namespace}-other`;
const projectIds = [projectId, otherProjectId];

const dayOf = (id: string, day: string, traceCount: number): NurturingTraceDayState => ({
  ...emptyTraceDay(),
  projectId: id,
  day,
  traceCount,
  lastTraceAt: 1_000,
  LastEventOccurredAt: 1_000,
});

const context = (key: string, appliedEventIds: string[] = []) => ({
  aggregateId: key,
  tenantId: createTenantId(key),
  key,
  appliedEventIds,
});

describe.skipIf(!databaseUrl)("given nurturing's trace-day rows", () => {
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
    await connection.client.nurturingProjectTraceDay.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    await connection.client.nurturingProjectTraceSeed.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    await connection.closeOnce();
  });

  describe("when the fold stores a project's day twice", () => {
    /** @scenario "A trace is its root span, counted on its project's day" */
    it("keeps one row per project and day, with the last delivery's event ids", async () => {
      const key = traceDayKey({ projectId, day: "2026-11-19" });

      await repository.store.store(dayOf(projectId, "2026-11-19", 1), context(key, ["event-1"]));
      await repository.store.store(dayOf(projectId, "2026-11-19", 2), context(key, ["event-2"]));

      await expect(repository.store.getWithApplied?.(key, context(key))).resolves.toEqual({
        state: dayOf(projectId, "2026-11-19", 2),
        appliedEventIds: ["event-2"],
      });
    });
  });

  describe("when the organization's days are read and pruned", () => {
    /** @scenario "Trace days older than the window are deleted" */
    it("reads the projects' days after the window's start and deletes the older ones", async () => {
      for (const [id, day] of [
        [projectId, "2026-10-01"],
        [projectId, "2026-11-18"],
        [otherProjectId, "2026-11-20"],
      ] as const) {
        const key = traceDayKey({ projectId: id, day });
        await repository.store.store(dayOf(id, day, 1), context(key));
      }

      const read = await repository.findForProjects({ projectIds, afterDay: "2026-10-21" });
      expect(read.map((day) => `${day.projectId}:${day.day}`).toSorted()).toEqual([
        `${otherProjectId}:2026-11-20`,
        `${projectId}:2026-11-18`,
        `${projectId}:2026-11-19`,
      ]);

      await repository.pruneBefore({ projectIds, beforeDay: "2026-10-21" });
      const kept = await repository.findForProjects({ projectIds, afterDay: "2000-01-01" });
      expect(kept.map((day) => day.day)).not.toContain("2026-10-01");
    });
  });

  describe("when a project is seeded twice", () => {
    /** @scenario "A project that traced before the fold started is seeded once from trace's rollup" */
    it("keeps the first seed, and reads its days after the window's start", async () => {
      await repository.recordSeed({
        projectId: otherProjectId,
        seededAt: 1_000,
        days: [dayOf(otherProjectId, "2026-10-01", 7), dayOf(otherProjectId, "2026-11-01", 2)],
      });
      await repository.recordSeed({
        projectId: otherProjectId,
        seededAt: 2_000,
        days: [dayOf(otherProjectId, "2026-11-01", 9)],
      });

      await expect(repository.findSeeds({ projectIds, afterDay: "2026-10-21" })).resolves.toEqual({
        seededProjectIds: [otherProjectId],
        days: [dayOf(otherProjectId, "2026-11-01", 2)],
      });
    });
  });
});
