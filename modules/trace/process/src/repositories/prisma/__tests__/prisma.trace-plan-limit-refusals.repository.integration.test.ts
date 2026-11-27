/**
 * @vitest-environment node
 * Trace's plan-limit refusal counter over real Postgres, through the tenancy-guarded client every
 * process composes. Runs with LANGWATCH_TEST_DATABASE_URL; the memory twin runs the same cases.
 */
import { randomBytes } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { afterAll, describe, expect, it } from "vitest";

import { describePlanLimitRefusalsContract } from "../../../features/ingestion/repositories/__tests__/trace-plan-limit-refusals.repository.contract.ts";
import { PrismaTracePlanLimitRefusalsRepository } from "../prisma.trace-plan-limit-refusals.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("given the Postgres trace plan-limit refusal counter", () => {
  const prisma = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("trace-plan-limit-refusals-integration"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }))
    .client as PrismaClient;
  const projects: string[] = [];

  afterAll(async () => {
    await cleanupTestRows(prisma, [["tracePlanLimitRefusal", { projectId: { in: projects } }]]);
    await prisma.$disconnect();
  });

  const newProject = () => {
    const projectId = `project-${randomBytes(5).toString("hex")}`;
    projects.push(projectId);
    return projectId;
  };

  describe("given refusals recorded for two projects on several days", () => {
    describe("when the refusals are counted over a range of days", () => {
      /** @scenario Refusals are summed per project over the days a range touches */
      it("gives each project only its own refusals inside the range", async () => {
        const repository = PrismaTracePlanLimitRefusalsRepository.create({ prisma });
        const [project, other] = [newProject(), newProject()];
        const day = (n: number) => Date.UTC(2026, 9, 1) + n * 24 * 60 * 60 * 1000;
        for (const [projectId, n] of [
          [project, 0],
          [project, 1],
          [project, 2],
          [project, 2],
          [project, 4],
          [other, 2],
        ] as const) {
          await repository.recordRefusal({ projectId, dayStartMs: day(n) });
        }

        const counts = await repository.countRefusals({
          projectIds: [project, other],
          fromDayMs: day(1),
          toDayMs: day(3),
        });

        expect(Object.fromEntries(counts)).toEqual({ [project]: 3, [other]: 1 });
      });
    });
  });

  describePlanLimitRefusalsContract({
    create: () => PrismaTracePlanLimitRefusalsRepository.create({ prisma }),
    projectId: newProject,
  });
});
