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
} from "@copilotkit/runtime";
import { describeRoute } from "hono-openapi";

import { createProjectApp, requires } from "~/server/api/security";
import { createLogger } from "~/utils/logger/server";
import { PromptStudioAdapter } from "./service-adapter";

const logger = createLogger("langwatch:api:copilotkit");

const secured = createProjectApp({
  basePath: "/api/copilotkit",
  family: "copilotkit",
});

// The CopilotKit runtime adapts the project's prompt configs into the prompt
// studio context, so a prompt read is the correct ceiling.
secured.access(requires("prompts:view")).post(
  "/",
  describeRoute({
    description: "Get simulation thread",
  }),
  async (c) => {
    const project = c.get("project");
    const runtime = new CopilotRuntime();

    const handler = copilotRuntimeNodeHttpEndpoint({
      runtime,
      serviceAdapter: new PromptStudioAdapter({
        projectId: project.id,
      }),
      endpoint: "/api/copilotkit",
    });

    logger.info({ projectId: project.id }, "Creating simulation thread");

    return handler(c.req.raw);
  },
);

export const app = secured.hono;
