/**
 * CopilotKit runtime endpoint
 * @see https://docs.copilotkit.ai/quickstart?copilot-hosting=self-hosted
 * @description This is the endpoint required to create the context for the Copilokit
 * frontend. However, it's not currently doing anything, as we have disabled the input
 * feature of the frontend and we are setting the messages there directly.
 */
import {
  CopilotRuntime,
  copilotRuntimeNodeHttpEndpoint,
  ExperimentalEmptyAdapter,
} from "@copilotkit/runtime";
import type { Project } from "@prisma/client";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";

import { type LlmConfigRepository } from "~/server/prompt-config/repositories/llm-config.repository";

import {
  authMiddleware,
  handleError,
  loggerMiddleware,
} from "../../middleware";

import { createLogger } from "~/utils/logger";

const logger = createLogger("langwatch:api:copilotkit");

// Define types for our Hono context variables
type Variables = {
  project: Project;
  llmConfigRepository: LlmConfigRepository;
};

// Define the Hono app
export const app = new Hono<{
  Variables: Variables;
}>().basePath("/api/copilotkit");

// Middleware
app.use(loggerMiddleware());
app.use("/*", authMiddleware);
app.onError(handleError);

// Get all prompts
app.post(
  "/",
  describeRoute({
    description: "Get simulation thread",
  }),
  async (c) => {
    const project = c.get("project");
    const runtime = new CopilotRuntime();

    const handler = copilotRuntimeNodeHttpEndpoint({
      runtime,
      serviceAdapter: new ExperimentalEmptyAdapter(),
      endpoint: "/api/copilotkit",
    });

    logger.info({ projectId: project.id }, "Creating simulation thread");

    return handler(c.req.raw);
  }
);
