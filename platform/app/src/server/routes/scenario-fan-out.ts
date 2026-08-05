/**
 * Hono route for Fan Scenarios generation.
 *
 * POST /api/scenario/fan-out/generate
 *
 * Generates a bounded batch (5-8) of LLM-generated "adjacent" variant
 * scenarios from a seed failure — a failed scenario run, an annotated
 * production trace, or a pasted incident description — and persists them
 * pending review. See specs/scenarios/adjacent-scenario-generation.feature.
 */

import { createLogger } from "@langwatch/observability";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { hasProjectPermission } from "~/server/api/rbac";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { enforceLicenseLimit } from "~/server/license-enforcement";
import {
  isAbortLikeError,
  nlpgoHandledErrorFrom,
} from "~/server/nlpgo/goHandledError";
import { FanOutGenerationService } from "~/server/scenarios/fan-out/fan-out-generation.service";
import type { NextRequestShim as any } from "./types";

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
      type: z.literal("ANNOTATED_TRACE"),
      traceId: z.string().min(1),
      annotationId: z.string().min(1),
      annotationComment: z.string().min(1),
    }),
    z.object({
      type: z.literal("FREE_TEXT"),
      description: z.string().min(1),
    }),
  ]),
});

const secured = createServiceApp({ basePath: "/api/scenario/fan-out" });

secured.access(
  handlerManagedAuth("user session validated in-handler via getServerAuthSession"),
).post("/generate", async (c) => {
  const session = await getServerAuthSession({ req: c.req.raw as any });
  if (!session) {
    return c.json(
      { error: "You must be logged in to access this endpoint." },
      { status: 401 },
    );
  }

  let body;
  try {
    body = requestSchema.parse(await c.req.json());
  } catch (error) {
    logger.error({ error }, "Invalid request body");
    return c.json({ error: "Invalid request body" }, { status: 400 });
  }

  const hasPermission = await hasProjectPermission(
    { prisma, session },
    body.projectId,
    "scenarios:manage",
  );
  if (!hasPermission) {
    return c.json(
      { error: "You do not have permission to access this endpoint." },
      { status: 403 },
    );
  }

  try {
    // A fan-out batch persists 5-8 real Scenario rows immediately (unlike the
    // single-scenario AI modal, which defers persistence until Save) — so the
    // plan limit applies here, at generation time, not later.
    await enforceLicenseLimit({ prisma, session }, body.projectId, "scenarios");
  } catch (error) {
    if (error instanceof TRPCError) {
      return c.json({ error: error.message }, { status: 402 });
    }
    throw error;
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
    const handled = nlpgoHandledErrorFrom(error);
    if (handled) {
      logger.warn(
        { error: handled.serialize() },
        "Fan-out generation rejected by LLM gateway",
      );
      return c.json(
        { error: handled.code, domainError: handled.serialize() },
        { status: handled.httpStatus as 400 },
      );
    }

    if (isAbortLikeError(error)) {
      logger.warn({ error }, "Fan-out generation timed out");
      return c.json(
        {
          error:
            "Generation took too long and was stopped. This is usually temporary — please try again in a moment.",
        },
        { status: 504 },
      );
    }

    logger.error({ error }, "Error generating adjacent scenarios");

    const errorMessage =
      error instanceof Error ? error.message : "Failed to generate adjacent scenarios";

    return c.json({ error: errorMessage }, { status: 500 });
  }
});

export const app = secured.hono;
