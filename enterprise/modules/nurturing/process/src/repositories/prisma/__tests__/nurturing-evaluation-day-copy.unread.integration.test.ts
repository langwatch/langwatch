// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The usage read, over real Postgres rows: an old `evaluation` usage row still holding its
 * `activeDays` is not read. The days that count come from `NurturingProjectEvaluationDay` alone,
 * so a sentinel day left in the old row never reaches the merged usage.
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  emptyProjectUsage,
  evaluationActivityOf,
} from "../../../rules/nurturing-project-usage.rules.ts";
import { NURTURING_PROJECT_USAGE_PROJECTION_VERSION } from "../../nurturing-project-usage.repository.ts";
import { PrismaNurturingEvaluationDayRepository } from "../prisma.nurturing-evaluation-day.repository.ts";
import { PrismaNurturingProjectUsageRepository } from "../prisma.nurturing-project-usage.repository.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("langwatch:nurturing:test:evaluation-day-unread"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;
const prisma = connection?.client as PrismaClient;

describe.skipIf(!databaseUrl)(
  "given an old evaluation usage row that still holds active days",
  () => {
    const ns = `eval-unread-${randomUUID().slice(0, 8)}`;
    const COPIED = `project-copied-${ns}`;
    const OLD_ONLY = `project-old-only-${ns}`;
    const projectIds = [COPIED, OLD_ONLY];
    const SENTINEL_DAY = "2026-11-09";
    const AFTER_DAY = "2026-10-31";
    const updatedAt = new Date("2026-11-01T00:00:00.000Z");
    const usage = (projectId: string, owner: string, activeDays: string[]) => ({
      projectId,
      owner,
      folded: { ...emptyProjectUsage(projectId), activeDays },
      appliedEventIds: [],
      // The current version, so only the owner, never a stale version, keeps the row unread.
      projectionVersion: NURTURING_PROJECT_USAGE_PROJECTION_VERSION,
      updatedAt,
    });

    beforeAll(async () => {
      await prisma.nurturingProjectUsageView.createMany({
        data: [
          usage(COPIED, "evaluation", [SENTINEL_DAY]),
          usage(COPIED, "prompt", ["2026-11-05"]),
          usage(OLD_ONLY, "evaluation", [SENTINEL_DAY]),
        ],
      });
      await prisma.nurturingProjectEvaluationDay.createMany({
        data: [
          { projectId: COPIED, day: "2026-11-01" },
          { projectId: COPIED, day: "2026-11-03" },
        ],
      });
    });

    afterAll(async () => {
      if (!prisma) return;
      await prisma.nurturingProjectEvaluationDay.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await prisma.nurturingProjectUsageView.deleteMany({
        where: { projectId: { in: projectIds } },
      });
    });

    /** The read the organization sync makes: usage rows merged with the copied evaluation days. */
    async function mergedUsage() {
      const projectUsage = PrismaNurturingProjectUsageRepository.create({ prisma });
      const evaluationDays = PrismaNurturingEvaluationDayRepository.create({ prisma });
      const [usageRows, evaluated] = await Promise.all([
        projectUsage.findForProjects({ projectIds }),
        evaluationDays.findForProjects({ projectIds, afterDay: AFTER_DAY }),
      ]);
      return [...usageRows, ...evaluationActivityOf(evaluated)];
    }

    const activeDaysOf = (merged: Awaited<ReturnType<typeof mergedUsage>>, projectId: string) =>
      merged
        .filter((state) => state.projectId === projectId)
        .flatMap((state) => state.activeDays)
        .toSorted();

    describe("when the usage is read for a project that has copied days", () => {
      it("returns the copied days and the other owners' days", async () => {
        expect(activeDaysOf(await mergedUsage(), COPIED)).toEqual([
          "2026-11-01",
          "2026-11-03",
          "2026-11-05",
        ]);
      });

      it("leaves the old row's day out", async () => {
        expect(activeDaysOf(await mergedUsage(), COPIED)).not.toContain(SENTINEL_DAY);
      });
    });

    describe("when the usage is read for a project whose only days are in the old row", () => {
      it("returns no days", async () => {
        expect(activeDaysOf(await mergedUsage(), OLD_ONLY)).toEqual([]);
      });
    });

    describe("when the old rows are read directly", () => {
      it("still holds the sentinel, so the reads above left it out rather than found it missing", async () => {
        const old = await prisma.nurturingProjectUsageView.findUnique({
          where: { projectId_owner: { projectId: COPIED, owner: "evaluation" } },
        });

        expect(old?.folded).toMatchObject({ activeDays: [SENTINEL_DAY] });
      });
    });
  },
);
