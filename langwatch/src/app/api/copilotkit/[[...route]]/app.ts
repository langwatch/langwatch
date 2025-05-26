import type { Project } from "@prisma/client";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { LlmConfigRepository } from "~/server/prompt-config/repositories/llm-config.repository";
import { createLogger } from "~/utils/logger";
import {
  authMiddleware,
  errorMiddleware,
  loggerMiddleware,
} from "../../middleware";
import {
  CopilotRuntime,
  copilotRuntimeNodeHttpEndpoint,
  ExperimentalEmptyAdapter,
} from "@copilotkit/runtime";
import type { BaseEvent } from "@ag-ui/core";
import { AbstractAgent, EventType, type RunAgentInput } from "@ag-ui/client";
import { from, Observable } from "rxjs";
import { exampleEvents } from "./example-events";

const logger = createLogger("langwatch:api:prompts");

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
app.use("/*", errorMiddleware);

// Get all prompts
app.post(
  "/",
  describeRoute({
    description: "Get simulation thread",
  }),
  async (c) => {
    const project = c.get("project");
    console.log("request received");
    const runtime = new CopilotRuntime({
      agents: {
        "scenario-agent": new ScenarioAgent(),
      },
    });

    const handler = copilotRuntimeNodeHttpEndpoint({
      runtime,
      serviceAdapter: new ExperimentalEmptyAdapter(),
      endpoint: "/api/copilotkit",
    });

    logger.info({ projectId: project.id }, "Creating simulation thread");

    return handler(c.req.raw);
  }
);

class ScenarioAgent extends AbstractAgent {
  protected run(input: RunAgentInput): Observable<BaseEvent> {
    const { threadId, runId } = input;
    console.log("running scenario agent", threadId, runId);

    const events =
      exampleEvents.filter((event) => event.threadId === threadId) ?? [];

    console.log(events);

    return from(
      events.map((event) => ({
        ...event,
        threadId,
        runId,
      }))
    );
  }
}
