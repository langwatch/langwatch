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
  type CopilotServiceAdapter,
} from "@copilotkit/runtime";
import { createLogger } from "@langwatch/observability";
import { describeRoute } from "hono-openapi";

import { requires } from "@langwatch/api";
import {
  type AppRestProjectVariables,
  type AppRestSecurity,
  type SecuredApp,
} from "@langwatch/api/rest";

const logger = createLogger("langwatch:api:copilotkit");

/**
 * The prompt-studio adapter one project's runtime speaks through.
 *
 * A port because the adapter composes the workflow studio, the NLP runtime and
 * the project's model providers — the prompt/workflow vertical's own graph,
 * which the transport neither owns nor needs to see.
 */
export type CopilotServiceAdapterFactory = (input: { projectId: string }) => CopilotServiceAdapter;

/** The CopilotKit runtime endpoint, `/api/copilotkit`. */
export function createCopilotKitRestApp(options: {
  security: AppRestSecurity;
  serviceAdapterFor: CopilotServiceAdapterFactory;
}): SecuredApp<{ Variables: AppRestProjectVariables }> {
  const { security, serviceAdapterFor } = options;

  const secured = security.createProjectApp({
    basePath: "/api/copilotkit",
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
        serviceAdapter: serviceAdapterFor({ projectId: project.id }),
        endpoint: "/api/copilotkit",
      });

      logger.info({ projectId: project.id }, "Creating simulation thread");

      return handler(c.req.raw);
    },
  );

  return secured;
}
