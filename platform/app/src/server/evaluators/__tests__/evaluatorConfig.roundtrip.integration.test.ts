/**
 * @vitest-environment node
 *
 * langwatch#6397 — the config round-trip against a REAL Postgres.
 *
 * Every other test for this fix fakes `monitors.getMonitorById`, so the stored
 * `config` never actually goes through Prisma and jsonb. That is precisely where
 * a shape bug hides: the defect being fixed IS a shape mismatch between what the
 * write path stores and what the read path expects, and an in-memory object
 * round-trips perfectly whether or not the real column does.
 *
 * The load-bearing case is the FIRST one: a row inserted with raw SQL, in the
 * shape the reporting customer's evaluator is already in. Write-side
 * normalisation was tried and reverted (it broke code evaluators), so NOTHING
 * converts that row — if read-time recovery does not work against it, the fix
 * does not help the person who filed the issue.
 *
 * Requires LANGWATCH_TEST_DATABASE_URL. Skips cleanly without it so the suite
 * stays runnable on a box with no database.
 */

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { resolveEvaluatorSettingsWithSource } from "../../event-sourcing/pipelines/evaluation-processing/commands/executeEvaluation.command";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const PROJECT_ID = "proj_6397_roundtrip";
const USER_PROMPT = "Is the response empathetic and polite in tone?";

describe.skipIf(!DB_URL)("evaluator config round-trip through Postgres", () => {
  // Optional: vitest runs `afterAll` even when `beforeAll` threw, so a teardown
  // that dereferences this unconditionally replaces the real setup error with a
  // "cannot read property of undefined" and hides why the suite failed.
  let prisma: PrismaClient | undefined;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });
    await cleanupTestRows(prisma, [["evaluator", { projectId: PROJECT_ID }]]);
  });

  afterAll(async () => {
    if (!prisma) return;
    await cleanupTestRows(prisma, [["evaluator", { projectId: PROJECT_ID }]]);
    await prisma.$disconnect();
  });

  describe("given a row nothing on the write side will ever convert", () => {
    it("recovers the user's prompt at read time, with no migration", async () => {
      // Raw SQL on purpose: this bypasses the repository, so the row lands in
      // exactly the broken shape the customer's evaluator is already in.
      await prisma!.$executeRawUnsafe(
        `INSERT INTO "Evaluator" (id, "projectId", name, type, config, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5::jsonb, now(), now())`,
        "eval_6397_legacy",
        PROJECT_ID,
        "legacy tone judge",
        "evaluator",
        JSON.stringify({
          evaluatorType: "langevals/llm_boolean",
          prompt: USER_PROMPT,
          model: "openai/gpt-5-mini",
        }),
      );

      const row = await prisma!.evaluator.findFirstOrThrow({
        where: { id: "eval_6397_legacy", projectId: PROJECT_ID },
      });

      const { settings } = resolveEvaluatorSettingsWithSource({
        config: row.config as Record<string, unknown>,
        parameters: null,
        // Read back from Postgres rather than restated: recovery is gated on
        // this column, and reading it proves the value survives the write
        // path. (The column is an unconstrained `String`, so this is not the
        // database agreeing to anything — just the row answering for itself.)
        evaluatorRecordType: row.type,
      });

      // Exact, not partial: `toMatchObject` cannot fail if the resolver leaks
      // `evaluatorType` (a CONFIG_METADATA_KEY) into the payload sent to the
      // judge, and stripping that metadata is half of what the resolver does.
      expect(settings).toEqual({
        prompt: USER_PROMPT,
        model: "openai/gpt-5-mini",
      });
    });
  });
});
