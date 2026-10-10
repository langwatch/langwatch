/**
 * @vitest-environment node
 * One daily run on a running stack: the operator task asks for it, the stack's own worker
 * carries it out with a real Langy turn, and this test reads how it ended from Postgres.
 * Skipped unless every variable in `NEEDED` below is set. Never reads the workspace `.env`.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

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
 * model Langy can reach.
 */
const NEEDED = {
  /** A dotenv file: that stack's whole environment, its DATABASE_URL included. */
  INSIGHT_LIVE_ENV_FILE: process.env.INSIGHT_LIVE_ENV_FILE ?? "",
  INSIGHT_LIVE_RUN_PROJECT_ID: process.env.INSIGHT_LIVE_RUN_PROJECT_ID ?? "",
  INSIGHT_LIVE_RUN_USER_ID: process.env.INSIGHT_LIVE_RUN_USER_ID ?? "",
  INSIGHT_LIVE_RUN_BOARD_ID: process.env.INSIGHT_LIVE_RUN_BOARD_ID ?? "",
};
const envFile = path.resolve(NEEDED.INSIGHT_LIVE_ENV_FILE);
const projectId = NEEDED.INSIGHT_LIVE_RUN_PROJECT_ID;
const userId = NEEDED.INSIGHT_LIVE_RUN_USER_ID;
const boardId = NEEDED.INSIGHT_LIVE_RUN_BOARD_ID;
const unset = Object.entries(NEEDED).flatMap(([name, value]) => (value === "" ? [name] : []));
const isLive = unset.length === 0;
/** Set with a real model: the stand-in model writes no findings block, so it files nothing. */
const isFilingExpected = process.env.INSIGHT_LIVE_EXPECT_FILED === "1";

/** A run waits ten minutes for Langy at most; the worker then records it. */
const RUN_SETTLES_WITHIN_MS = 12 * 60_000;
const TASKS_ENTRY = fileURLToPath(
  new URL("../../../../../../apps/tasks/src/main.ts", import.meta.url),
);

/** The stack's Postgres, from the file the caller named: the task and these reads share it. */
function stackDatabaseUrl(): string {
  const databaseUrl = parseEnv(readFileSync(envFile, "utf8")).DATABASE_URL;
  if (!databaseUrl) throw new Error("INSIGHT_LIVE_ENV_FILE holds no DATABASE_URL");
  return databaseUrl;
}

/**
 * The operator task as `pnpm task` starts it, but its environment is the caller's file and
 * nothing inherited. It runs in an empty directory, because the secrets chain falls back on
 * the `.env` of the directory it runs in.
 */
function requestRun(): void {
  const emptyDirectory = mkdtempSync(path.join(tmpdir(), "insight-live-run-"));
  try {
    const task = spawnSync(
      process.execPath,
      [
        "--experimental-transform-types",
        `--env-file=${envFile}`,
        TASKS_ENTRY,
        "insight-daily-run-request",
        projectId,
        userId,
        "dashboard",
        boardId,
      ],
      // PATH and HOME name no stack; every other variable comes from the file.
      {
        cwd: emptyDirectory,
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
        encoding: "utf8",
      },
    );
    if (task.status !== 0) throw new Error(`the task failed: ${task.stderr}`);
  } finally {
    rmSync(emptyDirectory, { recursive: true });
  }
}

type RunRow = Prisma.InsightDailyScheduleProjectionGetPayload<object>;
type InsightRow = Prisma.InsightProjectionGetPayload<object>;

/** Why a run without a named stack is skipped, on every skipped line of the report. */
const skipped = isLive ? "" : ` (skipped: set ${unset.join(", ")})`;

describe.skipIf(!isLive)(`given a stack that is up, with a member and a board${skipped}`, () => {
  const connection = isLive
    ? PrismaConnectionService.create({
        guard: PrismaTenancyGuardService.create(),
        logger: createTestLogger().logger,
      }).connect(
        PrismaConfigService.create().resolve({ databaseUrl: stackDatabaseUrl(), log: ["error"] }),
      )
    : null;
  let row: RunRow;
  let filed: InsightRow[];

  beforeAll(async () => {
    if (!connection) throw new Error("INSIGHT_LIVE_ENV_FILE is required here");
    const database = connection.client;
    const id = dailyScheduleId({ projectId, userId, board: { kind: "dashboard", id: boardId } });
    const read = () =>
      database.insightDailyScheduleProjection.findFirst({ where: { id, projectId } });
    const before = await read();

    requestRun();

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
