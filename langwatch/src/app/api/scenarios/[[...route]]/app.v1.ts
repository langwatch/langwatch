import type { Scenario } from "@prisma/client";
import { validator as zValidator } from "hono-openapi/zod";
import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "~/server/db";
import { ScenarioNotFoundError } from "~/server/scenarios/errors";
import { ScenarioService } from "~/server/scenarios/scenario.service";
import { createLogger } from "~/utils/logger/server";
import type { AuthMiddlewareVariables } from "../../middleware";

const logger = createLogger("langwatch:api:scenarios");

type Variables = AuthMiddlewareVariables;

export const app = new Hono<{ Variables: Variables }>().basePath("/");

const getService = () => ScenarioService.create(prisma);

const createScenarioSchema = z.object({
  name: z.string().min(1, "name is required"),
  situation: z.string().optional().default(""),
  criteria: z.array(z.string()).optional().default([]),
  labels: z.array(z.string()).optional().default([]),
});

const updateScenarioSchema = z.object({
  name: z.string().min(1).optional(),
  situation: z.string().optional(),
  criteria: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
});

function toScenarioResponse(scenario: Scenario) {
  return {
    id: scenario.id,
    name: scenario.name,
    situation: scenario.situation,
    criteria: scenario.criteria,
    labels: scenario.labels,
  };
}

app.get("/", async (c) => {
  const project = c.get("project");
  logger.info({ projectId: project.id }, "Listing scenarios");

  const service = getService();
  const scenarios = await service.getAll({ projectId: project.id });

  return c.json(scenarios.map(toScenarioResponse));
});

app.get("/:id", async (c) => {
  const project = c.get("project");
  const { id } = c.req.param();
  logger.info({ projectId: project.id, scenarioId: id }, "Getting scenario");

  const service = getService();
  const scenario = await service.getById({ id, projectId: project.id });

  if (!scenario) {
    return c.json({ error: "Scenario not found" }, 404);
  }

  return c.json(toScenarioResponse(scenario));
});

app.post("/", zValidator("json", createScenarioSchema), async (c) => {
  const project = c.get("project");
  const body = c.req.valid("json");

  logger.info({ projectId: project.id }, "Creating scenario");

  const service = getService();
  const scenario = await service.create({
    projectId: project.id,
    name: body.name,
    situation: body.situation,
    criteria: body.criteria,
    labels: body.labels,
  });

  return c.json(toScenarioResponse(scenario), 201);
});

app.put("/:id", zValidator("json", updateScenarioSchema), async (c) => {
  const project = c.get("project");
  const { id } = c.req.param();
  const body = c.req.valid("json");

  logger.info(
    { projectId: project.id, scenarioId: id },
    "Updating scenario",
  );

  const service = getService();
  const existing = await service.getById({ id, projectId: project.id });
  if (!existing) {
    return c.json({ error: "Scenario not found" }, 404);
  }

  const scenario = await service.update(id, project.id, {
    ...(body.name !== undefined && { name: body.name }),
    ...(body.situation !== undefined && { situation: body.situation }),
    ...(body.criteria !== undefined && { criteria: body.criteria }),
    ...(body.labels !== undefined && { labels: body.labels }),
  });

  return c.json(toScenarioResponse(scenario));
});

app.delete("/:id", async (c) => {
  const project = c.get("project");
  const { id } = c.req.param();

  logger.info(
    { projectId: project.id, scenarioId: id },
    "Archiving scenario",
  );

  const service = getService();
  try {
    await service.archive({ id, projectId: project.id });
    return c.json({ id, archived: true });
  } catch (error) {
    if (error instanceof ScenarioNotFoundError) {
      return c.json({ error: "Scenario not found" }, 404);
    }
    throw error;
  }
});
