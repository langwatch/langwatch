import { createLogger } from "@langwatch/observability";
import {
  parseScenarioParameterDefinitions,
  scenarioParameterDefinitionSchema,
  scenarioParameterDefinitionsSchema,
  ScenarioNotFoundError,
  type Scenario,
} from "@langwatch/scenario-contract";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { badRequestSchema } from "~/app/api/shared/schemas";
import { requires, type SecuredApp } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import type { AuthMiddlewareVariables } from "../../middleware";
import { baseResponses } from "../../shared/base-responses";
import { platformUrl } from "../../shared/platform-url";

const logger = createLogger("langwatch:api:scenarios");

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

const scenarioVersionSummarySchema = z.object({
  version: z.number().int().describe("The version number, counting from 1."),
  authorLabel: z
    .string()
    .nullable()
    .describe(
      "Which surface wrote the version: user, api, cli or langy. Null on the synthesized Created entry of a case saved before versions were recorded.",
    ),
  authorId: z
    .string()
    .nullable()
    .describe(
      "The user who saved the version. Null when the save came from an API key.",
    ),
  changeDescription: z.string().nullable(),
  changedFields: z
    .array(z.string())
    .describe("The fields whose value this save changed."),
  createdAt: z.string().describe("When the version was written, in ISO 8601."),
  isSynthesized: z
    .boolean()
    .describe(
      "True on the Created entry a case saved before versions were recorded shows. It has no stored snapshot, so it cannot be read back.",
    ),
});

const scenarioVersionListResponseSchema = z.object({
  versions: z.array(scenarioVersionSummarySchema),
  nextCursor: z
    .number()
    .int()
    .nullable()
    .describe(
      "Pass as cursor to read the page below this one. Null on the last page.",
    ),
});

const scenarioVersionDetailResponseSchema = scenarioVersionSummarySchema.extend(
  {
    schemaVersion: z
      .number()
      .int()
      .describe("The shape the snapshot was written in."),
    snapshot: z
      .object({
        name: z.string(),
        situation: z.string(),
        criteria: z.array(z.string()),
        labels: z.array(z.string()),
        parameters: z.array(scenarioParameterDefinitionSchema),
        simulatorModel: z.string().nullable(),
        judgeModel: z.string().nullable(),
        maxTurns: z.number().nullable(),
        minTurns: z.number().nullable(),
      })
      .describe("The editable content of the case as this version saved it."),
  },
);

const listScenarioVersionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Read the page below this version number."),
});

const versionPathSchema = z.object({
  version: z.coerce.number().int().min(1),
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
  registerListScenarioVersionsRoute(secured);
  registerGetScenarioVersionRoute(secured);
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

      const scenarios = await c.app.scenarios.list({ projectId: project.id });

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
      logger.info({ projectId: project.id, scenarioId: id }, "Getting scenario");

      const scenario = await c.app.scenarios.tryGetById({
        id,
        projectId: project.id,
      });

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

      const scenario = await c.app.scenarios.create({
        projectId: project.id,
        name: body.name,
        situation: body.situation,
        criteria: body.criteria,
        labels: body.labels,
        ...(body.parameters !== undefined && { parameters: body.parameters }),
      });

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

      logger.info({ projectId: project.id, scenarioId: id }, "Updating scenario");

      const existing = await c.app.scenarios.tryGetById({
        id,
        projectId: project.id,
      });
      if (!existing) {
        return c.json({ error: "Scenario not found" }, 404);
      }

      const scenario = await c.app.scenarios.update({
        id,
        projectId: project.id,
        ...(body.name !== undefined && { name: body.name }),
        ...(body.situation !== undefined && { situation: body.situation }),
        ...(body.criteria !== undefined && { criteria: body.criteria }),
        ...(body.labels !== undefined && { labels: body.labels }),
        ...(body.parameters !== undefined && { parameters: body.parameters }),
      });

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
              schema: resolver(z.object({ id: z.string(), archived: z.boolean() })),
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

      logger.info({ projectId: project.id, scenarioId: id }, "Archiving scenario");

      try {
        await c.app.scenarios.archive({ id, projectId: project.id });
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

/** The version history of a scenario, newest first. */
function registerListScenarioVersionsRoute(
  secured: SecuredApp<{ Variables: AuthMiddlewareVariables }>,
): void {
  secured.access(requires("scenarios:view")).get(
    "/:id/versions",
    describeRoute({
      description:
        "List the saved versions of a scenario, newest first. A scenario saved before versions were recorded closes its history with a synthesized Created entry.",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(scenarioVersionListResponseSchema),
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
    zValidator("query", listScenarioVersionsQuerySchema),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      const { limit, cursor } = c.req.valid("query");

      logger.info(
        { projectId: project.id, scenarioId: id },
        "Listing scenario versions",
      );

      const service = getService();
      try {
        const page = await service.listVersions({
          projectId: project.id,
          scenarioId: id,
          ...(limit !== undefined && { limit }),
          ...(cursor !== undefined && { cursor }),
        });
        return c.json({
          versions: page.versions.map((version) => ({
            version: version.version,
            authorLabel: version.authorLabel,
            authorId: version.authorId,
            changeDescription: version.changeDescription,
            changedFields: version.changedFields,
            createdAt: version.createdAt.toISOString(),
            isSynthesized: version.isSynthesized,
          })),
          nextCursor: page.nextCursor,
        });
      } catch (error) {
        if (error instanceof ScenarioNotFoundError) {
          return c.json({ error: "Scenario not found" }, 404);
        }
        throw error;
      }
    },
  );
}

/**
 * One version of a scenario with the content it saved.
 *
 * A version number that names nothing refuses with the
 * `scenario_version_not_found` code, which the synthesized Created entry also
 * answers: it has no stored snapshot to serve.
 */
function registerGetScenarioVersionRoute(
  secured: SecuredApp<{ Variables: AuthMiddlewareVariables }>,
): void {
  secured.access(requires("scenarios:view")).get(
    "/:id/versions/:version",
    describeRoute({
      description:
        "Get one saved version of a scenario, with the name, situation, criteria, labels and parameters as that version saved them.",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(scenarioVersionDetailResponseSchema),
            },
          },
        },
        404: {
          description: "Scenario or version not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    zValidator("param", versionPathSchema),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      const { version } = c.req.valid("param");

      logger.info(
        { projectId: project.id, scenarioId: id, version },
        "Getting scenario version",
      );

      const service = getService();
      try {
        const detail = await service.getVersion({
          projectId: project.id,
          scenarioId: id,
          version,
        });
        return c.json({
          version: detail.version,
          authorLabel: detail.authorLabel,
          authorId: detail.authorId,
          changeDescription: detail.changeDescription,
          changedFields: detail.changedFields,
          createdAt: detail.createdAt.toISOString(),
          isSynthesized: detail.isSynthesized,
          schemaVersion: detail.schemaVersion,
          snapshot: {
            name: detail.fields.name,
            situation: detail.fields.situation,
            criteria: detail.fields.criteria,
            labels: detail.fields.labels,
            parameters: parseScenarioParameterDefinitions(
              detail.fields.parameters,
            ),
            simulatorModel: detail.fields.simulatorModel,
            judgeModel: detail.fields.judgeModel,
            maxTurns: detail.fields.maxTurns,
            minTurns: detail.fields.minTurns,
          },
        });
      } catch (error) {
        if (error instanceof ScenarioNotFoundError) {
          return c.json({ error: "Scenario not found" }, 404);
        }
        throw error;
      }
    },
  );
}
