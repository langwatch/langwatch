import type { Project } from "@prisma/client";
import { Hono } from "hono";
import { LlmConfigRepository } from "~/server/prompt-config/repositories/llm-config.repository";
import { createLogger } from "~/utils/logger";
import {
  authMiddleware,
  errorMiddleware,
  loggerMiddleware,
} from "../../middleware";
import { AGUIEventRepository } from "./ag-ui-event.repository";
import { ScenarioRunnerService } from "./scenario-runner.service";

const logger = createLogger("langwatch:api:prompts");

// Define types for our Hono context variables
type Variables = {
  project: Project;
  llmConfigRepository: LlmConfigRepository;
  agUIEventRepository: AGUIEventRepository;
};

// Define the Hono app
export const app = new Hono<{
  Variables: Variables;
}>().basePath("/api/ag-ui");

// Middleware
app.use(loggerMiddleware());
app.use("/*", errorMiddleware);
app.use("/*", authMiddleware);

// Add repository middleware
app.use("*", async (c, next) => {
  c.set("agUIEventRepository", new AGUIEventRepository());
  await next();
});

// Add event endpoints
app.get("/events", async (c) => {
  const { project } = c.var;
  const repository = c.var.agUIEventRepository;

  const events = await repository.getEventsByProjectId(project.id);
  return c.json({ events });
});

app.get("/events/:threadId", async (c) => {
  const threadId = c.req.param("threadId");
  const { project } = c.var;
  const repository = c.var.agUIEventRepository;

  const events = await repository.getEventsByThreadId({
    threadId,
    projectId: project.id,
  });
  return c.json({ events });
});

// Add POST endpoint for saving events
app.post("/events", async (c) => {
  const { project } = c.var;
  const repository = c.var.agUIEventRepository;
  const event = await c.req.json();

  await repository.saveEvent({
    ...event,
    projectId: project.id,
  });

  return c.json({ success: true });
});

app.get("/threads", async (c) => {
  const { project } = c.var;
  const repository = c.var.agUIEventRepository;

  const threads = await repository.getAllThreadsForProject(project.id);
  return c.json({ threads });
});

// Scenario runner endpoints -- consider moving to a separate route
app.get("/scenario-state/:threadId", async (c) => {
  const { project } = c.var;
  const threadId = c.req.param("threadId");

  const scenarioRunnerService = new ScenarioRunnerService();
  const state = await scenarioRunnerService.getScenarioState({
    projectId: project.id,
    threadId,
  });

  console.log({ state, threadId });

  return c.json({ state });
});

// Scenario runner endpoints -- consider moving to a separate route
app.get("/scenario-thread-ids", async (c) => {
  const { project } = c.var;

  const scenarioRunnerService = new ScenarioRunnerService();
  const state = await scenarioRunnerService.getScenarioThreadIds({
    projectId: project.id,
  });

  return c.json({ state });
});
