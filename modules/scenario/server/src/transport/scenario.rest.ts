/**
 * `/api/scenarios` - the scenarios (test cases) a project defines, and their
 * version history. `platformUrl` arrives as a factory argument, resolved by
 * the process at mount time, exactly as the deployment's external origin
 * always has to be: a transport package has no access to it and must not
 * read it for itself.
 *
 * The family answers a miss in the bare `{ error }` body it has always had
 * - `errorEnvelope: "legacy"` on the pre-conversion family - so
 * `scenarioRestErrorHandler` stays the mount's own `onError`, composed over
 * the process's boundary handler.
 */
import { createLogger } from "@langwatch/observability";
import { modelOverrideSchema } from "@langwatch/model-provider-contract";
import {
  parseScenarioParameterDefinitions,
  scenarioParameterDefinitionSchema,
  scenarioParameterDefinitionsSchema,
  ScenarioApi,
  ScenarioNotFoundError,
  type Scenario,
} from "@langwatch/scenario-contract";
import type { ErrorHandler } from "hono";
import { z } from "zod";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectRestFacts,
  resolver,
  type PlatformUrlBuilder,
} from "@langwatch/api/rest";

const logger = createLogger("langwatch:api:scenarios");

/**
 * A scenario or version this project does not hold. The family answers it in
 * the bare `{ error }` body it has always had, so the miss is raised as the
 * family's own error and rendered by the family's own handler.
 */
export class ScenarioRestNotThereError extends Error {}

/** The family's 404s, in the body they have always had. */
export const scenarioRestErrorHandler =
  (boundary: ErrorHandler): ErrorHandler =>
  (error, c) => {
    if (error instanceof ScenarioRestNotThereError) {
      return c.json({ error: error.message }, 404);
    }
    return boundary(error, c);
  };

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
    .describe("The user who saved the version. Null when the save came from an API key."),
  changeDescription: z.string().nullable(),
  changedFields: z.array(z.string()).describe("The fields whose value this save changed."),
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
    .describe("Pass as cursor to read the page below this one. Null on the last page."),
});

const scenarioVersionDetailResponseSchema = scenarioVersionSummarySchema.extend({
  schemaVersion: z.number().int().describe("The shape the snapshot was written in."),
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
});

const listScenarioVersionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Read the page below this version number."),
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
  parameters: scenarioParameterDefinitionsSchema.optional().describe(parametersDescription),
  simulatorModel: modelOverrideSchema.nullish().describe(simulatorModelDescription),
  judgeModel: modelOverrideSchema.nullish().describe(judgeModelDescription),
  maxTurns: z.number().int().min(1).max(100).nullish().describe(maxTurnsDescription),
  minTurns: z.number().int().min(0).max(100).nullish().describe(minTurnsDescription),
  testSuiteId: z.string().nullish().describe(testSuiteIdDescription),
});

const updateScenarioSchema = z.object({
  name: z.string().min(1).optional(),
  situation: z.string().optional(),
  criteria: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
  parameters: scenarioParameterDefinitionsSchema.optional().describe(parametersDescription),
  simulatorModel: modelOverrideSchema.nullish().describe(simulatorModelDescription),
  judgeModel: modelOverrideSchema.nullish().describe(judgeModelDescription),
  maxTurns: z.number().int().min(1).max(100).nullish().describe(maxTurnsDescription),
  minTurns: z.number().int().min(0).max(100).nullish().describe(minTurnsDescription),
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

/** Where a scenario opens in the platform: its own editor drawer. */
function scenarioEditorPath(scenarioId: string): string {
  return `/simulations/scenarios?drawer.open=scenarioEditor&drawer.scenarioId=${scenarioId}`;
}

const idParamsSchema = z.object({ id: z.string().min(1) });
const idVersionParamsSchema = idParamsSchema.extend({
  version: z.coerce.number().int().min(1),
});
const archivedScenarioSchema = z.object({ id: z.string(), archived: z.boolean() });

const legacyErrorBodySchema = z.object({ error: z.string() });

const scenarioNotFoundResponse = {
  404: {
    description: "Scenario not found",
    content: { "application/json": { schema: resolver(legacyErrorBodySchema) } },
  },
};

/**
 * REST for the scenarios (test cases) a project defines, and their version
 * history. `platformUrl` is resolved by the process at mount time.
 */
export function createScenarioRest(options: { platformUrl: PlatformUrlBuilder }) {
  const { platformUrl } = options;

  const withPlatformUrl = (scenario: Scenario, projectSlug: string) => ({
    ...toScenarioResponse(scenario),
    platformUrl: platformUrl({ projectSlug, path: scenarioEditorPath(scenario.id) }),
  });

  return defineRestRouter(ScenarioApi)
    .withNamespace("scenarios")
    .withVersion(MANAGEMENT_API_VERSION)

    /** List every scenario in the project. */
    .get("/", "listScenarios")
    .withPermission("scenarios:view")
    .withOutput(z.array(scenarioResponseWithPlatformUrlSchema))
    .withDocs({ description: "Get all scenarios for a project" })
    .withMiddleware(projectRestFacts)
    .handle(async ({ app, scope }, project) => {
      logger.info({ projectId: scope.id }, "Listing scenarios");
      const listed = await app.list({ projectId: scope.id });
      return listed.map((s) => withPlatformUrl(s, project.projectSlug));
    })

    /** Read one scenario by id. */
    .get("/:id", "getScenario")
    .withParams(idParamsSchema)
    .withPermission("scenarios:view")
    .withOutput(scenarioResponseWithPlatformUrlSchema)
    .withDocs({
      description: "Get a specific scenario by ID",
      responses: scenarioNotFoundResponse,
    })
    .withMiddleware(projectRestFacts)
    .handle(async ({ app, input, scope }, project) => {
      logger.info({ projectId: scope.id, scenarioId: input.id }, "Getting scenario");
      const scenario = await app.tryGetById({ id: input.id, projectId: scope.id });
      if (!scenario) throw new ScenarioRestNotThereError("Scenario not found");
      return withPlatformUrl(scenario, project.projectSlug);
    })

    // Creating asks for `scenarios:create`, not `scenarios:manage`. Nobody
    // loses access: `:manage` implies `:create`, so every role and key that
    // could create a scenario yesterday still can. What changes is that access
    // granted at the CREATE grain now works.
    .post("/", "createScenario")
    .withInput(createScenarioSchema)
    .withPermission("scenarios:create")
    .withOutput(scenarioResponseWithPlatformUrlSchema)
    .withStatus(201)
    .withDocs({ description: "Create a new scenario" })
    .withMiddleware(projectRestFacts)
    .handle(async ({ app, input: body, scope }, project) => {
      logger.info({ projectId: scope.id }, "Creating scenario");
      const scenario = await app.create(
        {
          projectId: scope.id,
          name: body.name,
          situation: body.situation,
          criteria: body.criteria,
          labels: body.labels,
          ...(body.parameters !== undefined && { parameters: body.parameters }),
          ...(body.simulatorModel !== undefined && { simulatorModel: body.simulatorModel }),
          ...(body.judgeModel !== undefined && { judgeModel: body.judgeModel }),
          ...(body.maxTurns !== undefined && { maxTurns: body.maxTurns }),
          ...(body.minTurns !== undefined && { minTurns: body.minTurns }),
          ...(body.testSuiteId !== undefined && { testSuiteId: body.testSuiteId }),
        },
        { id: project.actorId },
      );
      return withPlatformUrl(scenario, project.projectSlug);
    })

    /**
     * Update a scenario in place. PUT and PATCH register the same handler:
     * both apply a partial update, so a client using either verb gets the
     * same behavior instead of a 404 on one of them.
     */
    .put("/:id", "updateScenario")
    .withParams(idParamsSchema)
    .withInput(updateScenarioSchema)
    .withPermission("scenarios:update")
    .withOutput(scenarioResponseWithPlatformUrlSchema)
    .withDocs({ description: "Update an existing scenario", responses: scenarioNotFoundResponse })
    .withMiddleware(projectRestFacts)
    .handle(async ({ app, input, scope }, project) => {
      const { id, ...body } = input;
      logger.info({ projectId: scope.id, scenarioId: id }, "Updating scenario");

      const existing = await app.tryGetById({ id, projectId: scope.id });
      if (!existing) throw new ScenarioRestNotThereError("Scenario not found");

      const scenario = await app.update(
        { id, projectId: scope.id, ...scenarioUpdateData(body) },
        { id: project.actorId },
      );
      return withPlatformUrl(scenario, project.projectSlug);
    })

    .patch("/:id", "patchScenario")
    .withParams(idParamsSchema)
    .withInput(updateScenarioSchema)
    .withPermission("scenarios:update")
    .withOutput(scenarioResponseWithPlatformUrlSchema)
    .withDocs({ description: "Update an existing scenario", responses: scenarioNotFoundResponse })
    .withMiddleware(projectRestFacts)
    .handle(async ({ app, input, scope }, project) => {
      const { id, ...body } = input;
      logger.info({ projectId: scope.id, scenarioId: id }, "Updating scenario");

      const existing = await app.tryGetById({ id, projectId: scope.id });
      if (!existing) throw new ScenarioRestNotThereError("Scenario not found");

      const scenario = await app.update(
        { id, projectId: scope.id, ...scenarioUpdateData(body) },
        { id: project.actorId },
      );
      return withPlatformUrl(scenario, project.projectSlug);
    })

    // Archiving deliberately still asks for `:manage`. Create and update were
    // refined because access issued at that grain was being refused; nothing
    // is asking to destroy scenarios at a finer grain.
    .delete("/:id", "archiveScenario")
    .withParams(idParamsSchema)
    .withPermission("scenarios:manage")
    .withOutput(archivedScenarioSchema)
    .withDocs({
      description: "Archive (soft-delete) a scenario",
      responses: scenarioNotFoundResponse,
    })
    .handle(async ({ app, input, scope }) => {
      const { id } = input;
      logger.info({ projectId: scope.id, scenarioId: id }, "Archiving scenario");
      try {
        await app.archive({ id, projectId: scope.id });
        return { id, archived: true };
      } catch (error) {
        if (error instanceof ScenarioNotFoundError) {
          throw new ScenarioRestNotThereError("Scenario not found");
        }
        throw error;
      }
    })

    /** The version history of a scenario, newest first. */
    .get("/:id/versions", "listScenarioVersions")
    .withParams(idParamsSchema)
    .withQuery(listScenarioVersionsQuerySchema)
    .withPermission("scenarios:view")
    .withOutput(scenarioVersionListResponseSchema)
    .withDocs({
      description:
        "List the saved versions of a scenario, newest first. A scenario saved before versions were recorded closes its history with a synthesized Created entry.",
      responses: scenarioNotFoundResponse,
    })
    .handle(async ({ app, input, scope }) => {
      const { id, limit, cursor } = input;
      logger.info({ projectId: scope.id, scenarioId: id }, "Listing scenario versions");
      try {
        const page = await app.listVersions({
          projectId: scope.id,
          scenarioId: id,
          ...(limit !== undefined && { limit }),
          ...(cursor !== undefined && { cursor }),
        });
        return {
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
        };
      } catch (error) {
        if (error instanceof ScenarioNotFoundError) {
          throw new ScenarioRestNotThereError("Scenario not found");
        }
        throw error;
      }
    })

    /**
     * One version of a scenario with the content it saved.
     *
     * A version number that names nothing refuses with the
     * `scenario_version_not_found` code, which the synthesized Created entry
     * also answers: it has no stored snapshot to serve.
     */
    .get("/:id/versions/:version", "getScenarioVersion")
    .withParams(idVersionParamsSchema)
    .withPermission("scenarios:view")
    .withOutput(scenarioVersionDetailResponseSchema)
    .withDocs({
      description:
        "Get one saved version of a scenario, with the name, situation, criteria, labels and parameters as that version saved them.",
      responses: {
        404: {
          description: "Scenario or version not found",
          content: { "application/json": { schema: resolver(legacyErrorBodySchema) } },
        },
      },
    })
    .handle(async ({ app, input, scope }) => {
      const { id, version } = input;
      logger.info({ projectId: scope.id, scenarioId: id, version }, "Getting scenario version");
      try {
        const detail = await app.getVersion({ projectId: scope.id, scenarioId: id, version });
        return {
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
            parameters: parseScenarioParameterDefinitions(detail.fields.parameters),
            simulatorModel: detail.fields.simulatorModel,
            judgeModel: detail.fields.judgeModel,
            maxTurns: detail.fields.maxTurns,
            minTurns: detail.fields.minTurns,
          },
        };
      } catch (error) {
        if (error instanceof ScenarioNotFoundError) {
          throw new ScenarioRestNotThereError("Scenario not found");
        }
        throw error;
      }
    })

    .build();
}
