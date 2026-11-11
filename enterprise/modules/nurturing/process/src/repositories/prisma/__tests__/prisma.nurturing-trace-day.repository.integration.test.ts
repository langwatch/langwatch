// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Nurturing's own trace counts, one row per project and UTC day, incremented in place by the
 * traces its counted-trace rows had not yet counted.
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { NurturingCountedTrace } from "../../../rules/nurturing-trace-day.rules.ts";
import { PrismaNurturingTraceDayRepository } from "../prisma.nurturing-trace-day.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-nurturing-trace-day-${randomUUID()}`;
const projectId = `${namespace}-project`;
const otherProjectId = `${namespace}-other`;
const projectIds = [projectId, otherProjectId];
const AT = Date.UTC(2026, 10, 19, 12);

const trace = (overrides: Partial<NurturingCountedTrace> = {}): NurturingCountedTrace => ({
  projectId,
  traceId: randomUUID(),
  kind: "trace",
  day: "2026-11-19",
  at: AT,
  ...overrides,
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
    await connection.client.nurturingProjectCountedTrace.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    await connection.closeOnce();
  });

  describe("when traces are counted into a day", () => {
    /** @scenario "Root spans of one project and day are written as one increment" */
    it("adds their counts to the project's day and keeps the newest times", async () => {
      await repository.countTraces([trace(), trace()]);
      await repository.countTraces([trace({ at: AT + 1000 }), trace({ kind: "failed", at: AT })]);

      await expect(
        repository.findForProjects({ projectIds: [projectId], afterDay: "2026-11-18" }),
      ).resolves.toEqual([
        {
          projectId,
          day: "2026-11-19",
          traceCount: 3,
          errorCount: 1,
          lastTraceAt: AT + 1000,
          lastFailedTraceAt: AT,
        },
      ]);
    });

    /** @scenario "A trace stored twice counts once" */
    it("counts a trace once per kind, in one batch, across batches and from two writers", async () => {
      const once = trace({ day: "2026-11-21", traceId: "stored-twice" });
      const failed = { ...once, kind: "failed" as const, at: AT + 5000 };

      await repository.countTraces([once, { ...once, at: AT + 1000 }]);
      await Promise.all([
        repository.countTraces([once, failed]),
        repository.countTraces([once, failed]),
      ]);

      const [counted] = await repository.findForProjects({
        projectIds: [projectId],
        afterDay: "2026-11-20",
      });
      expect(counted).toMatchObject({
        traceCount: 1,
        errorCount: 1,
        lastTraceAt: AT,
        lastFailedTraceAt: AT + 5000,
      });
    });

    it("loses no count when two writers add different traces to one day at once", async () => {
      const day = "2026-11-20";

      await Promise.all([
        repository.countTraces([trace({ day })]),
        repository.countTraces([trace({ day })]),
      ]);

      const [counted] = await repository.findForProjects({
        projectIds: [projectId],
        afterDay: "2026-11-19",
      });
      expect(counted?.traceCount).toBe(2);
    });
  });

  describe("when the organization's days are read and pruned", () => {
    /** @scenario "Trace days older than the window are deleted" */
    it("reads the projects' days after the window's start and deletes the older ones", async () => {
      await repository.countTraces([
        trace({ day: "2026-10-01", traceId: "old" }),
        trace({ projectId: otherProjectId, day: "2026-11-22" }),
      ]);

      const read = await repository.findForProjects({ projectIds, afterDay: "2026-10-21" });
      expect(read.map((day) => `${day.projectId}:${day.day}`).toSorted()).toEqual([
        `${otherProjectId}:2026-11-22`,
        `${projectId}:2026-11-19`,
        `${projectId}:2026-11-20`,
        `${projectId}:2026-11-21`,
      ]);

      await repository.pruneBefore({ projectIds, beforeDay: "2026-10-21" });
      const kept = await repository.findForProjects({ projectIds, afterDay: "2000-01-01" });
      expect(kept.map((day) => day.day)).not.toContain("2026-10-01");
      await expect(
        connection.client.nurturingProjectCountedTrace.findMany({
          where: { projectId, traceId: "old" },
        }),
      ).resolves.toEqual([]);
    });
  });
});
