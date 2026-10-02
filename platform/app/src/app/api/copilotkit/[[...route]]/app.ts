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
import { createLogger } from "@langwatch/observability";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import { getServerAuthSession } from "~/server/auth";
import { PromptStudioAdapter } from "./service-adapter";

const logger = createLogger("langwatch:api:copilotkit");

const secured = createServiceApp({ basePath: "/api/copilotkit" });

// The prompt playground chat in the browser is the only caller, so it
// authenticates with the signed-in session and names the project in
// `X-Project-Id`. The runtime adapts the project's prompt configs into the
// prompt studio context, so a prompt read is the correct ceiling.
secured
  .access(
    handlerManagedAuth({
      reason: "user session validated in-handler via getServerAuthSession",
      permissions: ["prompts:view"],
      credential: "session",
    }),
  )
  .post("/", async (c) => {
    const session = await getServerAuthSession({ req: c.req.raw as any });
    if (!session) {
      return c.json(
        { error: "You must be logged in to access this endpoint." },
        { status: 401 },
      );
    }

    const projectId = c.req.header("x-project-id");
    if (!projectId) {
      return c.json({ error: "Missing X-Project-Id header" }, { status: 400 });
    }

    const hasPermission = await probeProjectPermission(
      { session },
      projectId,
      "prompts:view",
    );
    if (!hasPermission) {
      return c.json(
        { error: "You do not have permission to access this endpoint." },
        { status: 403 },
      );
    }

    const runtime = new CopilotRuntime();
    const handler = copilotRuntimeNodeHttpEndpoint({
      runtime,
      serviceAdapter: new PromptStudioAdapter({ projectId }),
      endpoint: "/api/copilotkit",
    });

    logger.info({ projectId }, "Creating simulation thread");

    return handler(c.req.raw);
  });

export const app = secured.hono;
