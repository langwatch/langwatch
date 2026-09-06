import { createLogger } from "@langwatch/observability";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { badRequestSchema } from "~/app/api/shared/schemas";
import type { Scenario } from "~/generated/prisma/client";
import { requires, type SecuredApp } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { prisma } from "~/server/db";
import { modelOverrideSchema } from "~/server/modelProviders/modelOverrideSchema";
import { ScenarioNotFoundError } from "~/server/scenarios/errors";
import {
  parseScenarioParameterDefinitions,
  scenarioParameterDefinitionSchema,
  scenarioParameterDefinitionsSchema,
} from "~/server/scenarios/parameters";
import { ScenarioService } from "~/server/scenarios/scenario.service";
import type { ScenarioActor } from "~/server/scenarios/scenario-versioning";
import {
  readTestingInterface,
  scenarioEditorPath,
  type TestingInterface,
} from "~/server/suites/platform-path";
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
  /**
   * The five fields below are optional in the document, not in the answer:
   * every server sends them. They arrived after clients were generated from
   * this family, and a client that reads one as required fails against a
   * server that predates it.
   *
   * @see specs/api-reference/legacy-response-fields-optional.feature
   */
  simulatorModel: z
    .string()
    .nullable()
    .optional()
    .describe(
      "The model that plays the user, or null for the project default. Absent on servers that predate model overrides on this family.",
    ),
  judgeModel: z
    .string()
    .nullable()
    .optional()
    .describe(
      "The model that judges the run, or null for the project default. Absent on servers that predate model overrides on this family.",
    ),
  maxTurns: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe(
      "The most conversation turns a run of this scenario takes, or null for the default. Absent on servers that predate turn limits on this family.",
    ),
  minTurns: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe(
      "The fewest conversation turns before the judge may end a run, or null for the default. Absent on servers that predate turn limits on this family.",
    ),
  testSuiteId: z
    .string()
    .nullable()
    .optional()
    .describe(
      "The test suite this scenario is filed in, or null when unfiled. Absent on servers that predate test suites.",
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
      "Which surface wrote the version: user, api, cli or langy. Null on the synthesized Created entry of a scenario saved before versions were recorded.",
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
      "True on the Created entry a scenario saved before versions were recorded shows. It has no stored snapshot, so it cannot be read back.",
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
      .describe(
        "The editable content of the scenario as this version saved it.",
      ),
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

const testSuiteIdDescription =
  "The test suite to file this scenario in. It must name a non-archived test suite of the same project. null files the scenario into the project's Default test suite.";

const simulatorModelDescription =
  "Model for the simulated user, e.g. openai/gpt-5-mini. Null uses the project default.";
const judgeModelDescription =
  "Model for the judge, e.g. openai/gpt-5-mini. Null uses the project default.";
const maxTurnsDescription =
  "Maximum conversation turns for a run of this scenario. Null uses the default.";
const minTurnsDescription =
  "Minimum conversation turns before the judge may end the run. Null uses the default.";

const createScenarioSchema = z.object({
  name: z.string().min(1, "name is required"),
  situation: z.string(),
  criteria: z.array(z.string()).optional().default([]),
  labels: z.array(z.string()).optional().default([]),
  parameters: scenarioParameterDefinitionsSchema
    .optional()
    .describe(parametersDescription),
  simulatorModel: modelOverrideSchema
    .nullish()
    .describe(simulatorModelDescription),
  judgeModel: modelOverrideSchema.nullish().describe(judgeModelDescription),
  maxTurns: z
    .number()
    .int()
    .min(1)
    .max(100)
    .nullish()
    .describe(maxTurnsDescription),
  minTurns: z
    .number()
    .int()
    .min(0)
    .max(100)
    .nullish()
    .describe(minTurnsDescription),
  testSuiteId: z.string().nullish().describe(testSuiteIdDescription),
});

const updateScenarioSchema = z.object({
  name: z.string().min(1).optional(),
  situation: z.string().optional(),
  criteria: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
  parameters: scenarioParameterDefinitionsSchema
    .optional()
    .describe(parametersDescription),
  simulatorModel: modelOverrideSchema
    .nullish()
    .describe(simulatorModelDescription),
  judgeModel: modelOverrideSchema.nullish().describe(judgeModelDescription),
  maxTurns: z
    .number()
    .int()
    .min(1)
    .max(100)
    .nullish()
    .describe(maxTurnsDescription),
  minTurns: z
    .number()
    .int()
    .min(0)
    .max(100)
    .nullish()
    .describe(minTurnsDescription),
  testSuiteId: z.string().nullish().describe(testSuiteIdDescription),
});

/**
 * The fields the caller named. The schema marks every field optional, and a
 * field the body omits stays out of the update, so a PATCH never overwrites a
 * value the caller did not send. A null is a value: it clears the field.
 */
function scenarioUpdateData(
  body: z.infer<typeof updateScenarioSchema>,
): Partial<z.infer<typeof updateScenarioSchema>> {
  return Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined),
  ) as Partial<z.infer<typeof updateScenarioSchema>>;
}

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
    simulatorModel: scenario.simulatorModel,
    judgeModel: scenario.judgeModel,
    maxTurns: scenario.maxTurns,
    minTurns: scenario.minTurns,
    testSuiteId: scenario.testSuiteId,
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

      const service = getService();
      const scenarios = await service.getAll({ projectId: project.id });
      const ui = await readTestingInterface({
        projectId: project.id,
        organizationId: c.get("apiKeyOrganizationId"),
      });

      return c.json(
        scenarios.map((s) => ({
          ...toScenarioResponse(s),
          platformUrl: scenarioPlatformUrl({
            projectSlug: project.slug,
            scenarioId: s.id,
            ui,
          }),
        })),
      );
    },
  );
}

/** Where a scenario opens, in the interface the project reads. */
function scenarioPlatformUrl({
  projectSlug,
  scenarioId,
  ui,
}: {
  projectSlug: string;
  scenarioId: string;
  ui: TestingInterface;
}): string {
  return platformUrl({
    projectSlug,
    path: scenarioEditorPath({ ui, scenarioId }),
  });
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
        platformUrl: scenarioPlatformUrl({
          projectSlug: project.slug,
          scenarioId: scenario.id,
          ui: await readTestingInterface({
            projectId: project.id,
            organizationId: c.get("apiKeyOrganizationId"),
          }),
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
          ...(body.testSuiteId !== undefined && {
            testSuiteId: body.testSuiteId,
          }),
          ...(body.simulatorModel !== undefined && {
            simulatorModel: body.simulatorModel,
          }),
          ...(body.judgeModel !== undefined && { judgeModel: body.judgeModel }),
          ...(body.maxTurns !== undefined && { maxTurns: body.maxTurns }),
          ...(body.minTurns !== undefined && { minTurns: body.minTurns }),
        },
        { actor: actorFromRequest(c) },
      );

      return c.json(
        {
          ...toScenarioResponse(scenario),
          platformUrl: scenarioPlatformUrl({
            projectSlug: project.slug,
            scenarioId: scenario.id,
            ui: await readTestingInterface({
              projectId: project.id,
              organizationId: c.get("apiKeyOrganizationId"),
            }),
          }),
        },
        201,
      );
    },
  );

  // `:update` for the same reason as `:create` above — `:manage` still implies
  // it, so no existing caller changes.
}

/**
 * Update a scenario in place. PUT and PATCH register the same handler:
 * both apply a partial update, so a client using either verb gets the
 * same behavior instead of a 404 on one of them.
 */
function registerUpdateScenarioRoute(
  secured: SecuredApp<{ Variables: AuthMiddlewareVariables }>,
): void {
  for (const verb of ["put", "patch"] as const) {
    registerUpdateScenarioVerb({ secured, verb });
  }
}

function registerUpdateScenarioVerb({
  secured,
  verb,
}: {
  secured: SecuredApp<{ Variables: AuthMiddlewareVariables }>;
  verb: "put" | "patch";
}): void {
  secured.access(requires("scenarios:update"))[verb](
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

      const scenario = await service.update({
        id,
        projectId: project.id,
        data: scenarioUpdateData(body),
        options: { actor: actorFromRequest(c) },
      });

      return c.json({
        ...toScenarioResponse(scenario),
        platformUrl: scenarioPlatformUrl({
          projectSlug: project.slug,
          scenarioId: scenario.id,
          ui: await readTestingInterface({
            projectId: project.id,
            organizationId: c.get("apiKeyOrganizationId"),
          }),
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
