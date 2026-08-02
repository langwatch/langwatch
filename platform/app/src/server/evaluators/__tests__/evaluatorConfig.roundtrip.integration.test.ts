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
 * The load-bearing case is the FIRST one: a row inserted with raw SQL, bypassing
 * the normaliser entirely. That is the shape the reporting customer's evaluator
 * is already in — write-time normalisation cannot reach it, so if read-time
 * recovery does not work against a real row, the fix does not help the person who
 * filed the issue.
 *
 * Requires LANGWATCH_TEST_DATABASE_URL. Skips cleanly without it so the suite
 * stays runnable on a box with no database.
 */

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveEvaluatorSettings } from "../../event-sourcing/pipelines/evaluation-processing/commands/executeEvaluation.command";
import { normalizeEvaluatorConfig } from "../evaluatorConfig";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const PROJECT_ID = "proj_6397_roundtrip";
const USER_PROMPT = "Is the response empathetic and polite in tone?";

describe.skipIf(!DB_URL)("evaluator config round-trip through Postgres", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });
    await prisma.$executeRawUnsafe(
      `DELETE FROM "Evaluator" WHERE "projectId" = $1`,
      PROJECT_ID,
    );
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "Evaluator" WHERE "projectId" = $1`,
      PROJECT_ID,
    );
    await prisma.$disconnect();
  });

  describe("given a row written before the normaliser existed", () => {
    it("recovers the user's prompt at read time, with no migration", async () => {
      // Raw SQL on purpose: this bypasses the repository, so the row lands in
      // exactly the broken shape the customer's evaluator is already in.
      await prisma.$executeRawUnsafe(
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

      const row = await prisma.evaluator.findFirstOrThrow({
        where: { id: "eval_6397_legacy", projectId: PROJECT_ID },
      });

      const settings = resolveEvaluatorSettings({
        config: row.config as Record<string, unknown>,
        parameters: null,
      });

      expect(settings).toMatchObject({
        prompt: USER_PROMPT,
        model: "openai/gpt-5-mini",
      });
    });

    it("would have sent nothing under the old rule, which is the bug", async () => {
      const row = await prisma.evaluator.findFirstOrThrow({
        where: { id: "eval_6397_legacy", projectId: PROJECT_ID },
      });
      const config = row.config as Record<string, unknown>;

      // The pre-fix expression, verbatim: config.settings ?? monitor.parameters.
      const oldRule = config.settings ?? null;

      expect(oldRule).toBeNull();
    });
  });

  describe("given a row written through the normaliser", () => {
    it("stores the nested shape and reads it back intact", async () => {
      await prisma.evaluator.create({
        data: {
          id: "eval_6397_normalised",
          projectId: PROJECT_ID,
          name: "normalised tone judge",
          type: "evaluator",
          config: normalizeEvaluatorConfig({
            evaluatorType: "langevals/llm_boolean",
            prompt: USER_PROMPT,
          }) as object,
        },
      });

      const row = await prisma.evaluator.findFirstOrThrow({
        where: { id: "eval_6397_normalised", projectId: PROJECT_ID },
      });
      const config = row.config as Record<string, unknown>;

      // Stored in the shape the online path reads natively...
      expect(config.settings).toMatchObject({ prompt: USER_PROMPT });
      // ...and the resolver agrees after a real jsonb round-trip.
      expect(
        resolveEvaluatorSettings({ config, parameters: null }),
      ).toMatchObject({ prompt: USER_PROMPT });
    });
  });
});
