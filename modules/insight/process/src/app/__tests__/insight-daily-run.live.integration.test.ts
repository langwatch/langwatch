/**
 * @vitest-environment node
 * One daily run on a running stack: the operator task asks for it, the stack's own worker
 * carries it out with a real Langy turn, and this test reads how it ended from Postgres.
 * Skipped unless `INSIGHT_LIVE_RUN_PROJECT_ID` names a project on a stack that is up.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { Prisma } from "@langwatch/prisma-client/generated";
import { createTestLogger } from "@langwatch/test-harness";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { dailyScheduleId } from "../../rules/insight-daily-run.rules.ts";

/*
 * NEEDS one stack that is up (ui, api, worker): `release_insights` and Langy on for the
 * project, a member with analytics:view, a stored board with a custom chart widget, and a
 * model Langy can reach. INSIGHT_LIVE_DATABASE_URL is that stack's Postgres.
 */
const projectId = process.env.INSIGHT_LIVE_RUN_PROJECT_ID ?? "";
const userId = process.env.INSIGHT_LIVE_RUN_USER_ID ?? "";
const boardId = process.env.INSIGHT_LIVE_RUN_BOARD_ID ?? "";
const databaseUrl = process.env.INSIGHT_LIVE_DATABASE_URL ?? "";
/** Set with a real model: the stand-in model writes no findings block, so it files nothing. */
const isFilingExpected = process.env.INSIGHT_LIVE_EXPECT_FILED === "1";
const isLive = [projectId, userId, boardId, databaseUrl].every((value) => value.length > 0);

/** A run waits ten minutes for Langy at most; the worker then records it. */
const RUN_SETTLES_WITHIN_MS = 12 * 60_000;
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../../../", import.meta.url));
const TASK = ["--filter", "@langwatch/tasks", "task", "insight-daily-run-request"];

type RunRow = Prisma.InsightDailyScheduleProjectionGetPayload<object>;
type InsightRow = Prisma.InsightProjectionGetPayload<object>;

describe.skipIf(!isLive)("given a stack that is up, with a member and a board with widgets", () => {
  const connection = isLive
    ? PrismaConnectionService.create({
        guard: PrismaTenancyGuardService.create(),
        logger: createTestLogger().logger,
      }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
    : null;
  let row: RunRow;
  let filed: InsightRow[];

  beforeAll(async () => {
    if (!connection) throw new Error("INSIGHT_LIVE_DATABASE_URL is required here");
    const database = connection.client;
    const id = dailyScheduleId({ projectId, userId, board: { kind: "dashboard", id: boardId } });
    const read = () =>
      database.insightDailyScheduleProjection.findFirst({ where: { id, projectId } });
    const before = await read();

    const task = spawnSync("pnpm", [...TASK, projectId, userId, "dashboard", boardId], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
    });
    if (task.status !== 0) throw new Error(`the task failed: ${task.stderr}`);

    row = await vi.waitFor(
      async () => {
        const settled = await read();
        if (!settled?.lastRunId || settled.lastRunId === before?.lastRunId) {
          throw new Error("the run has not settled yet");
        }
        return settled;
      },
      { timeout: RUN_SETTLES_WITHIN_MS, interval: 5_000 },
    );
    filed = await database.insightProjection.findMany({
      where: { projectId, sourceConversationId: row.lastRunConversationId ?? "" },
    });
  }, RUN_SETTLES_WITHIN_MS + 60_000);

  afterAll(async () => {
    await connection?.closeOnce();
  });

  describe("when the operator task requests one run for them on that board", () => {
    it("reaches Langy as that member and records how the run ended", () => {
      expect(row.userId).toBe(userId);
      // A run that reached Langy names its conversation, whatever Langy then answered.
      expect(row.lastRunOutcome).not.toBe("skipped");
      expect(row.lastRunConversationId).toEqual(expect.any(String));
    });

    it("files what the run counted, for that member alone and pointing at the board", () => {
      expect(filed).toHaveLength(row.lastRunFiled ?? 0);
      expect(
        filed.filter(
          (insight) =>
            insight.filedVia === "run" &&
            insight.ownerUserId === userId &&
            insight.filedByUserId === null &&
            insight.boardId === boardId,
        ),
      ).toHaveLength(filed.length);
    });

    it.skipIf(!isFilingExpected)("files at least one insight when a real model answers", () => {
      expect(row.lastRunOutcome).toBe("filed");
      expect(filed.length).toBeGreaterThan(0);
    });
  });
});
