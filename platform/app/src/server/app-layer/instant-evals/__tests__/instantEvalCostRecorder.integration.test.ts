/**
 * @vitest-environment node
 *
 * The cost row an Instant Eval writes, against real Postgres.
 *
 * What matters here is where the row points. A synchronous query has no
 * durable resource, so its row points at the project; a run does, and naming
 * it is what turns "what did that run cost" into a query rather than a guess
 * from timestamps.
 *
 * @see ../instant-eval-cost.recorder.ts
 * @see ../../../../../specs/instant-evals/instant-eval-cost.feature
 */

import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";

import { CostReferenceType, CostType } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { PrismaInstantEvalCostRecorder } from "../instant-eval-cost.recorder";

const projectId = `project-instant-eval-cost-${nanoid(8)}`;
const runId = `instanteval_${nanoid(12)}`;

const recorder = new PrismaInstantEvalCostRecorder(prisma);

afterAll(async () => {
  await prisma.cost.deleteMany({ where: { projectId } });
});

describe("given a finished Instant Eval run", () => {
  describe("when its cost row is read", () => {
    /** @scenario The cost row names the run it belongs to */
    it("carries the Instant Eval type and points at the run", async () => {
      const costId = await recorder.recordCost({
        projectId,
        runId,
        inputTokens: 2_000_000,
        requests: 4_000,
        costUsd: 0.084,
        priceUsd: 0.1092,
      });

      const row = await prisma.cost.findFirst({
        where: { id: costId, projectId },
      });

      expect(row?.costType).toBe(CostType.INSTANT_EVAL);
      expect(row?.referenceType).toBe(CostReferenceType.INSTANT_EVAL);
      expect(row?.referenceId).toBe(runId);
      expect(row?.costName).toBe("Instant Eval run");
      expect(Number(row?.amount)).toBeCloseTo(0.084, 6);
      expect(row?.extraInfo).toMatchObject({
        input_tokens: 2_000_000,
        requests: 4_000,
        price_usd: 0.1092,
      });
    });

    it("points a synchronous query's row at the project instead", async () => {
      const costId = await recorder.recordCost({
        projectId,
        inputTokens: 1_000,
        requests: 2,
        costUsd: 0.000042,
        priceUsd: 0.0000546,
      });

      const row = await prisma.cost.findFirst({
        where: { id: costId, projectId },
      });

      expect(row?.referenceId).toBe(projectId);
      expect(row?.costName).toBe("Instant Eval query");
    });
  });
});
