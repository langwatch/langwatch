import type { Project } from "@prisma/client";
import { Hono } from "hono";
import {
  authMiddleware,
  errorMiddleware,
  loggerMiddleware,
} from "../../middleware";
import { ScenarioRunnerService } from "./scenario-event.service";
import { ScenarioEventType } from "./schemas";

// Define types for our Hono context variables
type Variables = {
  project: Project;
};

// Define the Hono app
export const app = new Hono<{
  Variables: Variables;
}>().basePath("/api/scenario-events");

// Middleware
app.use(loggerMiddleware());
app.use("/*", errorMiddleware);
app.use("/*", authMiddleware);

// Add event endpoints
app.post("/", async (c) => {
  const { project } = c.var;
  const event = await c.req.json();

  const scenarioRunnerService = new ScenarioRunnerService();
  await scenarioRunnerService.saveScenarioEvent({
    projectId: project.id,
    ...event,
  });

  return c.json({ success: true });
});

// Get scenario run state
app.get("/scenario-run/:scenarioRunId", async (c) => {
  const { project } = c.var;
  const scenarioRunId = c.req.param("scenarioRunId");

  const scenarioRunnerService = new ScenarioRunnerService();
  const state = await scenarioRunnerService.getScenarioRunState({
    projectId: project.id,
    scenarioRunId,
  });

  return c.json({ state });
});

// Get all scenario run IDs for a project
app.get("/run-ids", async (c) => {
  const { project } = c.var;

  const scenarioRunnerService = new ScenarioRunnerService();
  const scenarioRunIds = await scenarioRunnerService.getScenarioRunIds({
    projectId: project.id,
  });

  return c.json({ scenarioRunIds });
});

// Get all scenario run IDs for a project
app.get("/", async (c) => {
  const { project } = c.var;

  const scenarioRunnerService = new ScenarioRunnerService();
  const events = await scenarioRunnerService.getAllRunEventsForProject({
    projectId: project.id,
  });

  return c.json({
    events: events.filter(
      (event) => event.type === ScenarioEventType.RUN_FINISHED
    ),
  });
});

// Delete all events for a project
app.post("/delete-all", async (c) => {
  const { project } = c.var;

  const scenarioRunnerService = new ScenarioRunnerService();
  await scenarioRunnerService.deleteAllEventsForProject({
    projectId: project.id,
  });

  return c.json({ success: true });
});
