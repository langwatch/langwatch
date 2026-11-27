// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The `nurturing_evaluation_day_and_fold_columns` migration's copy, run over seeded `evaluation`
 * usage rows in real Postgres: one evaluation-day row per `activeDays` entry, and the old rows
 * left exactly as they were.
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("langwatch:nurturing:test:evaluation-day-copy"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;
const prisma = connection?.client as PrismaClient;

const MIGRATION_SQL = readFileSync(
  join(
    import.meta.dirname,
    "../../../../../../../../packages/prisma-client/prisma/migrations",
    "20261124120004_nurturing_evaluation_day_and_fold_columns/migration.sql",
  ),
  "utf8",
);

/** The migration's copy statement, limited to the projects this test seeded. */
function copyScopedTo({ projectIds }: { projectIds: string[] }): string {
  const statement = MIGRATION_SQL.match(
    /INSERT INTO "NurturingProjectEvaluationDay"[\s\S]*?;/,
  )?.[0];
  if (!statement) throw new Error("the migration no longer carries its copy statement");
  const owner = `WHERE usage."owner" = 'evaluation'`;
  if (!statement.includes(owner)) throw new Error("the copy no longer selects evaluation rows");
  const listed = projectIds.map((id) => `'${id}'`).join(", ");

  return statement.replace(owner, `${owner} AND usage."projectId" IN (${listed})`);
}

describe.skipIf(!databaseUrl)("the nurturing evaluation-day copy migration", () => {
  const ns = `eval-day-${randomUUID().slice(0, 8)}`;
  const TWO_DAYS = `project-two-${ns}`;
  const THREE_DAYS = `project-three-${ns}`;
  const NO_DAYS = `project-none-${ns}`;
  const OTHER_OWNER = `project-prompt-${ns}`;
  const projectIds = [TWO_DAYS, THREE_DAYS, NO_DAYS, OTHER_OWNER];
  const VALID_DAYS = `project-valid-${ns}`;
  const OBJECT_DAYS = `project-object-${ns}`;
  const STRING_DAYS = `project-string-${ns}`;
  const malformedCaseIds = [VALID_DAYS, OBJECT_DAYS, STRING_DAYS];
  const updatedAt = new Date("2026-11-01T00:00:00.000Z");
  const usage = (
    projectId: string,
    owner: string,
    activeDays: string[] | Record<string, string> | string,
  ) => ({
    projectId,
    owner,
    folded: { projectId, activeDays },
    appliedEventIds: [],
    projectionVersion: "test",
    updatedAt,
  });

  beforeAll(async () => {
    await prisma.nurturingProjectUsageView.createMany({
      data: [
        usage(TWO_DAYS, "evaluation", ["2026-11-01", "2026-11-03"]),
        usage(THREE_DAYS, "evaluation", ["2026-11-01", "2026-11-02", "2026-11-04"]),
        usage(NO_DAYS, "evaluation", []),
        usage(OTHER_OWNER, "prompt", ["2026-11-05"]),
      ],
    });
  });

  afterAll(async () => {
    if (!connection) return;
    const seeded = [...projectIds, ...malformedCaseIds];
    await prisma.nurturingProjectEvaluationDay.deleteMany({
      where: { projectId: { in: seeded } },
    });
    await prisma.nurturingProjectUsageView.deleteMany({ where: { projectId: { in: seeded } } });
    await connection.closeOnce();
  });

  const oldRows = () =>
    prisma.nurturingProjectUsageView.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: [{ projectId: "asc" }, { owner: "asc" }],
    });
  const newRows = () =>
    prisma.nurturingProjectEvaluationDay.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: [{ projectId: "asc" }, { day: "asc" }],
    });

  /** @scenario The migration copies each evaluation usage row's days and deletes nothing */
  it("copies one row per active day of each evaluation row, and leaves every old row as it was", async () => {
    const before = await oldRows();

    await prisma.$executeRawUnsafe(copyScopedTo({ projectIds }));

    expect((await newRows()).map((row) => [row.projectId, row.day])).toEqual([
      [THREE_DAYS, "2026-11-01"],
      [THREE_DAYS, "2026-11-02"],
      [THREE_DAYS, "2026-11-04"],
      [TWO_DAYS, "2026-11-01"],
      [TWO_DAYS, "2026-11-03"],
    ]);
    expect(await oldRows()).toEqual(before);
    expect(before).toHaveLength(4);
  });

  /** @scenario The copy can run again without adding or changing a row */
  it("adds nothing when the copy runs again", async () => {
    const rows = await newRows();
    const before = await oldRows();

    await prisma.$executeRawUnsafe(copyScopedTo({ projectIds }));

    expect(await newRows()).toEqual(rows);
    expect(await oldRows()).toEqual(before);
  });

  /** @scenario The copy skips an evaluation row whose active days are not a list */
  it("copies a valid evaluation row's days and skips rows whose active days are an object or a string", async () => {
    await prisma.nurturingProjectUsageView.createMany({
      data: [
        usage(VALID_DAYS, "evaluation", ["2026-11-06"]),
        usage(OBJECT_DAYS, "evaluation", { day: "2026-11-07" }),
        usage(STRING_DAYS, "evaluation", "2026-11-08"),
      ],
    });

    await prisma.$executeRawUnsafe(copyScopedTo({ projectIds: malformedCaseIds }));

    const copied = await prisma.nurturingProjectEvaluationDay.findMany({
      where: { projectId: { in: malformedCaseIds } },
      orderBy: [{ projectId: "asc" }, { day: "asc" }],
    });
    expect(copied.map((row) => [row.projectId, row.day])).toEqual([[VALID_DAYS, "2026-11-06"]]);
  });
});
