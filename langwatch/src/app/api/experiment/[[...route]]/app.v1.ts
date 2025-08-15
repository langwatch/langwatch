import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute } from "hono-openapi";
import { validator as zValidator, resolver } from "hono-openapi/zod";
import { z } from "zod";

import {
  type AuthMiddlewareVariables,
} from "../../middleware";
import {
  experimentServiceMiddleware,
  type ExperimentServiceMiddlewareVariables,
} from "../../experiment/middleware/experiment-service";
import { baseResponses } from "../../shared/base-responses";

import {
  experimentInitInputSchema,
  experimentInitResponseSchema,
  type ExperimentInitResponse,
} from "./schemas";

import { badRequestSchema } from "~/app/api/shared/schemas";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createLogger } from "~/utils/logger";

const logger = createLogger("langwatch:api:experiments");

patchZodOpenapi();

// Define types for our Hono context variables
type Variables = ExperimentServiceMiddlewareVariables &
  AuthMiddlewareVariables;

// Define the Hono app
export const app = new Hono<{
  Variables: Variables;
}>().basePath("/");

// Initialize experiment
app.post(
  "/init",
  describeRoute({
    description: "Initialize or find an experiment",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: resolver(experimentInitResponseSchema),
          },
        },
      },
      400: {
        description: "Bad Request",
        content: {
          "application/json": {
            schema: resolver(badRequestSchema),
          },
        },
      },
    },
  }),
  zValidator("json", experimentInitInputSchema),
  async (c) => {
    const service = c.get("experimentService");
    const project = c.get("project");
    const body = c.req.valid("json");

    logger.info(
      { 
        projectId: project.id, 
        experiment_id: body.experiment_id,
        experiment_slug: body.experiment_slug,
        experiment_type: body.experiment_type 
      }, 
      "Initializing experiment"
    );

    try {
      const experiment = await service.findOrCreateExperiment({
        project,
        experiment_id: body.experiment_id,
        experiment_slug: body.experiment_slug,
        experiment_type: body.experiment_type,
        experiment_name: body.experiment_name,
        workflowId: body.workflowId,
      });

      const response: ExperimentInitResponse = {
        path: `/${project.slug}/experiments/${experiment.slug}`,
        slug: experiment.slug,
      };

      logger.info(
        { 
          projectId: project.id, 
          experimentId: experiment.id,
          experimentSlug: experiment.slug 
        }, 
        "Experiment initialized successfully"
      );

      return c.json(experimentInitResponseSchema.parse(response));
    } catch (error) {
      logger.error(
        { 
          projectId: project.id, 
          error: error instanceof Error ? error.message : String(error),
          body 
        }, 
        "Failed to initialize experiment"
      );

      if (error instanceof Error) {
        if (error.message === "Experiment not found") {
          throw new HTTPException(404, { message: error.message });
        }
        if (error.message === "Either experiment_id or experiment_slug is required") {
          throw new HTTPException(400, { message: error.message });
        }
        // Handle validation errors
        if (error.message.includes("Validation") || error.message.includes("Invalid")) {
          throw new HTTPException(400, { message: error.message });
        }
        // Handle database/connection errors
        if (error.message.includes("database") || error.message.includes("connection")) {
          throw new HTTPException(503, { message: "Service temporarily unavailable" });
        }
      }

      throw new HTTPException(500, { message: "Internal server error" });
    }
  }
);
