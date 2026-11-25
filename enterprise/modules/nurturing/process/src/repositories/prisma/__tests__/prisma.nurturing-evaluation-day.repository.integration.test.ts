// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Nurturing's evaluation days in Postgres: insert-ignore, so the days of a project are the same
 * whatever order and however often they land, and the memory twin holds the same days.
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

import { MemoryNurturingEvaluationDayRepository } from "../../memory/memory.nurturing-evaluation-day.repository.ts";
import type {
  NurturingEvaluationDay,
  NurturingEvaluationDayRepository,
} from "../../nurturing-evaluation-day.repository.ts";
import { PrismaNurturingEvaluationDayRepository } from "../prisma.nurturing-evaluation-day.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const run = randomUUID();
const projectIds = [
  `test-nurturing-evaluation-day-forward-${run}`,
  `test-nurturing-evaluation-day-reverse-${run}`,
  `test-nurturing-evaluation-day-other-${run}`,
] as const;
const [forward, reverse, other] = projectIds;

const byProjectAndDay = (days: readonly NurturingEvaluationDay[]) =>
  days.toSorted((a, b) => a.projectId.localeCompare(b.projectId) || a.day.localeCompare(b.day));

/** One project's days as the map writes them: one at a time, then again in a batch with repeats. */
async function writeDays(
  repository: NurturingEvaluationDayRepository,
  projectId: string,
  days: readonly string[],
): Promise<void> {
  for (const day of days) await repository.recordDay({ projectId, day });
  await repository.recordDays([...days, ...days].map((day) => ({ projectId, day })));
}

describe.skipIf(!databaseUrl)("given nurturing's evaluation days in Postgres", () => {
  let connection: PrismaConnection;
  let evaluationDays: PrismaNurturingEvaluationDayRepository;

  beforeAll(() => {
    if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:nurturing:test:evaluation-days"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    evaluationDays = PrismaNurturingEvaluationDayRepository.create({ prisma: connection.client });
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.client.nurturingProjectEvaluationDay.deleteMany({
      where: { projectId: { in: [...projectIds] } },
    });
    await connection.closeOnce();
  });

  describe("when a project's days land in one order, in its reverse and more than once", () => {
    /** @scenario "A project's evaluation days are kept once each, whatever order and however often they land" */
    it("keeps each day once, the same both ways, as the memory twin does", async () => {
      const days = ["2026-11-01", "2026-11-03", "2026-11-02"];
      const twin = MemoryNurturingEvaluationDayRepository.create();
      await writeDays(evaluationDays, forward, days);
      await writeDays(evaluationDays, reverse, days.toReversed());
      await writeDays(twin, forward, days);
      await writeDays(twin, reverse, days.toReversed());
      const read = { projectIds: [forward, reverse], afterDay: "2026-10-31" };

      const held = byProjectAndDay(await evaluationDays.findForProjects(read));

      expect(held).toEqual(byProjectAndDay(await twin.findForProjects(read)));
      expect(held).toEqual(
        [forward, reverse].flatMap((projectId) =>
          days.toSorted().map((day) => ({ projectId, day })),
        ),
      );
    });
  });

  describe("when the read names a day and some of the projects", () => {
    it("answers only their days after that day", async () => {
      await evaluationDays.recordDays([
        { projectId: other, day: "2026-11-05" },
        { projectId: other, day: "2026-11-06" },
      ]);

      const read = await evaluationDays.findForProjects({
        projectIds: [other],
        afterDay: "2026-11-05",
      });

      expect(read).toEqual([{ projectId: other, day: "2026-11-06" }]);
    });
  });

  describe("when no project is named", () => {
    it("answers no day", async () => {
      await expect(
        evaluationDays.findForProjects({ projectIds: [], afterDay: "2026-01-01" }),
      ).resolves.toEqual([]);
    });
  });
});
