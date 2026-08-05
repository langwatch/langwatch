/**
 * Hono route for Fan Scenarios generation.
 *
 * POST /api/scenario/fan-out/generate
 *
 * Generates a bounded batch (5-8) of LLM-generated "adjacent" variant
 * scenarios from a seed failure, a failed scenario run or a pasted incident
 * description, and persists them pending review.
 * See specs/scenarios/adjacent-scenario-generation.feature.
 */

import { ValidationError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import { hasProjectPermission } from "~/server/api/rbac";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { ProjectPermissionDeniedError } from "~/server/app-layer/permissions/errors";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { isAbortLikeError } from "~/server/nlpgo/goHandledError";
import {
  FanOutGenerationTimedOutError,
  FanOutUnauthenticatedError,
} from "~/server/scenarios/fan-out/errors";
import { FanOutGenerationService } from "~/server/scenarios/fan-out/fan-out-generation.service";

const logger = createLogger("langwatch:api:scenario:fan-out");

const targetSchema = z.object({
  type: z.enum(["prompt", "http", "code", "workflow"]),
  referenceId: z.string(),
});

const requestSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  count: z.number().int().min(5).max(8).optional(),
  // Which target the generated variants will run against. Required for every
  // seed type: a Scenario carries no target of its own, it is picked at run
  // time, so the caller states it rather than the server guessing.
  target: targetSchema,
  seed: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("SCENARIO_RUN"),
      scenarioId: z.string().min(1),
      scenarioRunId: z.string().min(1),
    }),
    z.object({
      type: z.literal("FREE_TEXT"),
      description: z.string().min(1),
    }),
  ]),
});

const secured = createServiceApp({ basePath: "/api/scenario/fan-out" });

secured
  .access(
    handlerManagedAuth({
      reason: "user session validated in-handler via getServerAuthSession",
      permissions: ["scenarios:manage"],
      credential: "session",
    }),
  )
  .post("/generate", async (c) => {
    const session = await getServerAuthSession({ req: c.req.raw as never });
    if (!session) {
      throw new FanOutUnauthenticatedError();
    }

    const parsed = requestSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      throw ValidationError.fromZodError(parsed.error);
    }
    const body = parsed.data;

    const hasPermission = await hasProjectPermission(
      { prisma, session },
      body.projectId,
      "scenarios:manage",
    );
    if (!hasPermission) {
      throw new ProjectPermissionDeniedError("scenarios:manage");
    }

    try {
      const service = FanOutGenerationService.create(prisma);
      const result = await service.generate({
        projectId: body.projectId,
        createdById: session.user.id,
        target: body.target,
        seed: body.seed,
        count: body.count,
      });

      return c.json({
        batchId: result.batch.id,
        status: result.batch.status,
        variants: result.variants,
      });
    } catch (error) {
      // A generation that ran past its own deadline is retryable and says so.
      // Everything else keeps its own identity: handled errors carry their
      // code out through onError, and anything unrecognised stays unknown.
      if (isAbortLikeError(error)) {
        logger.warn(
          { projectId: body.projectId },
          "Fan-out generation timed out",
        );
        throw new FanOutGenerationTimedOutError({
          reasons: error instanceof Error ? [error] : [],
        });
      }
      throw error;
    }
  });

export const app = secured.hono;
