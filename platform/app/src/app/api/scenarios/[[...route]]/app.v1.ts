import { createLogger } from "@langwatch/observability";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { badRequestSchema } from "~/app/api/shared/schemas";
import type { Scenario } from "~/generated/prisma/client";
import { requires, type SecuredApp } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { prisma } from "~/server/db";
import { ScenarioNotFoundError } from "~/server/scenarios/errors";
import {
  parseScenarioParameterDefinitions,
  scenarioParameterDefinitionSchema,
  scenarioParameterDefinitionsSchema,
} from "~/server/scenarios/parameters";
import type { ScenarioActor } from "~/server/scenarios/scenario-versioning";
import { ScenarioService } from "~/server/scenarios/scenario.service";
import type { AuthMiddlewareVariables } from "../../middleware";
import { baseResponses } from "../../shared/base-responses";
import { platformUrl } from "../../shared/platform-url";

const logger = createLogger("langwatch:api:scenarios");

const getService = () => ScenarioService.create(prisma);

const scenarioResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  situation: z.string(),
  criteria: z.array(z.string()),
  labels: z.array(z.string()),
  parameters: z.array(scenarioParameterDefinitionSchema),
  folderId: z
    .string()
    .nullable()
    .describe(
      "The test suite (folder) this scenario is filed in, or null when unfiled.",
    ),
});

const scenarioResponseWithPlatformUrlSchema = scenarioResponseSchema.extend({
  platformUrl: z.string().url(),
});

const parametersDescription =
  "The parameters this scenario declares by name, each with an optional description and default. A run supplies values for these names, readable from the scenario's own text as params.NAME. A parameter marked secret carries no default: its value is supplied per run, encrypted, delivered to the target as secrets.NAME, and never readable from the scenario's own text.";

const folderIdDescription =
  "The test suite (folder) to file this scenario in. It must name a non-archived folder of the same project. null unfiles the scenario.";

const createScenarioSchema = z.object({
  name: z.string().min(1, "name is required"),
  situation: z.string(),
  criteria: z.array(z.string()).optional().default([]),
  labels: z.array(z.string()).optional().default([]),
  parameters: scenarioParameterDefinitionsSchema
    .optional()
    .describe(parametersDescription),
  folderId: z.string().nullish().describe(folderIdDescription),
});

const updateScenarioSchema = z.object({
  name: z.string().min(1).optional(),
  situation: z.string().optional(),
  criteria: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
  parameters: scenarioParameterDefinitionsSchema
    .optional()
    .describe(parametersDescription),
  folderId: z.string().nullish().describe(folderIdDescription),
});

/**
 * Who a version row written through this surface names as its author.
 *
 * A project key names no person, so `userId` stays null. The `langwatch` CLI
 * declares itself with `X-LangWatch-Surface: cli` on its scenario writes;
 * only that value is honored, so a caller cannot spoof an in-process surface
 * over the wire. Everything else is the API.
 */
function actorFromRequest(c: {
  req: { header: (name: string) => string | undefined };
}): ScenarioActor {
  const declared = c.req.header("X-LangWatch-Surface")?.toLowerCase();
  return { userId: null, label: declared === "cli" ? "cli" : "api" };
}

function toScenarioResponse(scenario: Scenario) {
  return {
    id: scenario.id,
    name: scenario.name,
    situation: scenario.situation,
    criteria: scenario.criteria,
    labels: scenario.labels,
    parameters: parseScenarioParameterDefinitions(scenario.parameters),
    folderId: scenario.folderId,
  };
}

export function registerScenarioRoutes(
  secured: SecuredApp<{ Variables: AuthMiddlewareVariables }>,
): void {
  registerListScenariosRoute(secured);
  registerGetScenarioRoute(secured);
  registerCreateScenarioRoute(secured);
  registerUpdateScenarioRoute(secured);
  registerDeleteScenarioRoute(secured);
}

/** List every scenario in the project. */
function registerListScenariosRoute(
  secured: SecuredApp<{ Variables: AuthMiddlewareVariables }>,
): void {
  secured.access(requires("scenarios:view")).get(
    "/",
    describeRoute({
      description: "Get all scenarios for a project",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.array(scenarioResponseWithPlatformUrlSchema)),
            },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      logger.info({ projectId: project.id }, "Listing scenarios");

      const service = getService();
      const scenarios = await service.getAll({ projectId: project.id });

      return c.json(
        scenarios.map((s) => ({
          ...toScenarioResponse(s),
          platformUrl: platformUrl({
            projectSlug: project.slug,
            path: `/simulations/scenarios?drawer.open=scenarioEditor&drawer.scenarioId=${s.id}`,
          }),
        })),
      );
    },
  );
}

/** Read one scenario by id. */
function registerGetScenarioRoute(
  secured: SecuredApp<{ Variables: AuthMiddlewareVariables }>,
): void {
  secured.access(requires("scenarios:view")).get(
    "/:id",
    describeRoute({
      description: "Get a specific scenario by ID",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(scenarioResponseWithPlatformUrlSchema),
            },
          },
        },
        404: {
          description: "Scenario not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      logger.info(
        { projectId: project.id, scenarioId: id },
        "Getting scenario",
      );

      const service = getService();
      const scenario = await service.getById({ id, projectId: project.id });

      if (!scenario) {
        return c.json({ error: "Scenario not found" }, 404);
      }

      return c.json({
        ...toScenarioResponse(scenario),
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/simulations/scenarios?drawer.open=scenarioEditor&drawer.scenarioId=${scenario.id}`,
        }),
      });
    },
  );

  // Creating asks for `scenarios:create`, not `scenarios:manage`.
  //
  // Nobody loses access: `:manage` implies `:create` through the RBAC
  // hierarchy, so every role and key that could create a scenario yesterday
  // still can. What changes is that access granted at the CREATE grain now
  // works — it used to be a permission the product would issue and then refuse
  // to honour, which is how an assistant scoped to exactly "read and create"
  // ended up unable to create anything. A viewer is unaffected: they keep the
  // read routes and are declined the write, as before.
}

/** Create a scenario. */
function registerCreateScenarioRoute(
  secured: SecuredApp<{ Variables: AuthMiddlewareVariables }>,
): void {
  secured.access(requires("scenarios:create")).post(
    "/",
    describeRoute({
      description: "Create a new scenario",
      responses: {
        ...baseResponses,
        201: {
          description: "Scenario created",
          content: {
            "application/json": {
              schema: resolver(scenarioResponseWithPlatformUrlSchema),
            },
          },
        },
      },
    }),
    zValidator("json", createScenarioSchema),
    async (c) => {
      const project = c.get("project");
      const body = c.req.valid("json");

      logger.info({ projectId: project.id }, "Creating scenario");

      const service = getService();
      const scenario = await service.create(
        {
          projectId: project.id,
          name: body.name,
          situation: body.situation,
          criteria: body.criteria,
          labels: body.labels,
          ...(body.parameters !== undefined && { parameters: body.parameters }),
          ...(body.folderId !== undefined && { folderId: body.folderId }),
        },
        { actor: actorFromRequest(c) },
      );

      return c.json(
        {
          ...toScenarioResponse(scenario),
          platformUrl: platformUrl({
            projectSlug: project.slug,
            path: `/simulations/scenarios?drawer.open=scenarioEditor&drawer.scenarioId=${scenario.id}`,
          }),
        },
        201,
      );
    },
  );

  // `:update` for the same reason as `:create` above — `:manage` still implies
  // it, so no existing caller changes.
}

/** Update a scenario in place. */
function registerUpdateScenarioRoute(
  secured: SecuredApp<{ Variables: AuthMiddlewareVariables }>,
): void {
  secured.access(requires("scenarios:update")).put(
    "/:id",
    describeRoute({
      description: "Update an existing scenario",
      responses: {
        ...baseResponses,
        200: {
          description: "Scenario updated",
          content: {
            "application/json": {
              schema: resolver(scenarioResponseWithPlatformUrlSchema),
            },
          },
        },
        404: {
          description: "Scenario not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    zValidator("json", updateScenarioSchema),
    async (c) => {
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

      const scenario = await service.update(
        id,
        project.id,
        {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.situation !== undefined && { situation: body.situation }),
          ...(body.criteria !== undefined && { criteria: body.criteria }),
          ...(body.labels !== undefined && { labels: body.labels }),
          ...(body.parameters !== undefined && { parameters: body.parameters }),
          ...(body.folderId !== undefined && { folderId: body.folderId }),
        },
        { actor: actorFromRequest(c) },
      );

      return c.json({
        ...toScenarioResponse(scenario),
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/simulations/scenarios?drawer.open=scenarioEditor&drawer.scenarioId=${scenario.id}`,
        }),
      });
    },
  );

  // Archiving deliberately still asks for `:manage`. Create and update were
  // refined because access issued at that grain was being refused; nothing is
  // asking to destroy scenarios at a finer grain, and the destructive verb is
  // the wrong place to widen who qualifies.
}

/** Archive a scenario. */
function registerDeleteScenarioRoute(
  secured: SecuredApp<{ Variables: AuthMiddlewareVariables }>,
): void {
  secured.access(requires("scenarios:manage")).delete(
    "/:id",
    describeRoute({
      description: "Archive (soft-delete) a scenario",
      responses: {
        ...baseResponses,
        200: {
          description: "Scenario archived",
          content: {
            "application/json": {
              schema: resolver(
                z.object({ id: z.string(), archived: z.boolean() }),
              ),
            },
          },
        },
        404: {
          description: "Scenario not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
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
    },
  );
}
