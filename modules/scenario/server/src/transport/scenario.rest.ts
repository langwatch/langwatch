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
import {
  parseScenarioParameterDefinitions,
  ScenarioApi,
  ScenarioNotFoundError,
  type Scenario,
  scenarioLegacyErrorBodySchema,
  scenarioRestResponseSchema,
  scenarioRestResponseWithPlatformUrlSchema,
  scenarioRestVersionSummarySchema,
  scenarioRestVersionListResponseSchema,
  scenarioRestVersionDetailResponseSchema,
  scenarioRestListVersionsQuerySchema,
  scenarioRestCreateSchema,
  scenarioRestUpdateSchema,
  scenarioRestIdParamsSchema,
  scenarioRestIdVersionParamsSchema,
  scenarioRestArchivedSchema,
} from "@langwatch/scenario-contract";
import type { ErrorHandler } from "hono";
import { z } from "zod";
import {
  defineRestMiddleware,
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

/**
 * The surface a write declares itself through, bound off the
 * X-LangWatch-Surface header. Only "cli" is honoured; every other value -
 * absent included - reads as "api", so a caller cannot claim an in-process
 * surface over the wire.
 */
export const scenarioRestSurface = defineRestMiddleware(
  "scenarioRestSurface",
  z.string().nullable(),
);

/** The version history's author label for a REST write, off its declared surface. */
function scenarioAuthorLabel(surface: string | null): "cli" | "api" {
  return surface?.toLowerCase() === "cli" ? "cli" : "api";
}

/** The family's 404s, in the body they have always had. */
export const scenarioRestErrorHandler =
  (boundary: ErrorHandler): ErrorHandler =>
  (error, c) => {
    if (error instanceof ScenarioRestNotThereError) {
      return c.json({ error: error.message }, 404);
    }
    return boundary(error, c);
  };

/**
 * The fields the caller named. The schema marks every field optional, and a
 * field the body omits stays out of the update, so a PATCH never overwrites a
 * value the caller did not send. A null is a value: it clears the field.
 */
function scenarioUpdateData(
  body: z.infer<typeof scenarioRestUpdateSchema>,
): Partial<z.infer<typeof scenarioRestUpdateSchema>> {
  return Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined),
  ) as Partial<z.infer<typeof scenarioRestUpdateSchema>>;
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

const scenarioNotFoundResponse = {
  404: {
    description: "Scenario not found",
    content: { "application/json": { schema: resolver(scenarioLegacyErrorBodySchema) } },
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
    .withOutput(z.array(scenarioRestResponseWithPlatformUrlSchema))
    .withDocs({ description: "Get all scenarios for a project" })
    .withMiddleware(projectRestFacts)
    .handle(async ({ app, scope }, project) => {
      logger.info({ projectId: scope.id }, "Listing scenarios");
      const listed = await app.list({ projectId: scope.id });
      return listed.map((s) => withPlatformUrl(s, project.projectSlug));
    })

    /** Read one scenario by id. */
    .get("/:id", "getScenario")
    .withParams(scenarioRestIdParamsSchema)
    .withPermission("scenarios:view")
    .withOutput(scenarioRestResponseWithPlatformUrlSchema)
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
    .withInput(scenarioRestCreateSchema)
    .withPermission("scenarios:create")
    .withOutput(scenarioRestResponseWithPlatformUrlSchema)
    .withStatus(201)
    .withDocs({ description: "Create a new scenario" })
    .withMiddleware(projectRestFacts, scenarioRestSurface)
    .handle(async ({ app, input: body, scope }, project, surface) => {
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
        { id: project.actorId, label: scenarioAuthorLabel(surface) },
      );
      return withPlatformUrl(scenario, project.projectSlug);
    })

    /**
     * Update a scenario in place. PUT and PATCH register the same handler:
     * both apply a partial update, so a client using either verb gets the
     * same behavior instead of a 404 on one of them.
     */
    .put("/:id", "updateScenario")
    .withParams(scenarioRestIdParamsSchema)
    .withInput(scenarioRestUpdateSchema)
    .withPermission("scenarios:update")
    .withOutput(scenarioRestResponseWithPlatformUrlSchema)
    .withDocs({ description: "Update an existing scenario", responses: scenarioNotFoundResponse })
    .withMiddleware(projectRestFacts, scenarioRestSurface)
    .handle(async ({ app, input, scope }, project, surface) => {
      const { id, ...body } = input;
      logger.info({ projectId: scope.id, scenarioId: id }, "Updating scenario");

      const existing = await app.tryGetById({ id, projectId: scope.id });
      if (!existing) throw new ScenarioRestNotThereError("Scenario not found");

      const scenario = await app.update(
        { id, projectId: scope.id, ...scenarioUpdateData(body) },
        { id: project.actorId, label: scenarioAuthorLabel(surface) },
      );
      return withPlatformUrl(scenario, project.projectSlug);
    })

    .patch("/:id", "patchScenario")
    .withParams(scenarioRestIdParamsSchema)
    .withInput(scenarioRestUpdateSchema)
    .withPermission("scenarios:update")
    .withOutput(scenarioRestResponseWithPlatformUrlSchema)
    .withDocs({ description: "Update an existing scenario", responses: scenarioNotFoundResponse })
    .withMiddleware(projectRestFacts, scenarioRestSurface)
    .handle(async ({ app, input, scope }, project, surface) => {
      const { id, ...body } = input;
      logger.info({ projectId: scope.id, scenarioId: id }, "Updating scenario");

      const existing = await app.tryGetById({ id, projectId: scope.id });
      if (!existing) throw new ScenarioRestNotThereError("Scenario not found");

      const scenario = await app.update(
        { id, projectId: scope.id, ...scenarioUpdateData(body) },
        { id: project.actorId, label: scenarioAuthorLabel(surface) },
      );
      return withPlatformUrl(scenario, project.projectSlug);
    })

    // Archiving deliberately still asks for `:manage`. Create and update were
    // refined because access issued at that grain was being refused; nothing
    // is asking to destroy scenarios at a finer grain.
    .delete("/:id", "archiveScenario")
    .withParams(scenarioRestIdParamsSchema)
    .withPermission("scenarios:manage")
    .withOutput(scenarioRestArchivedSchema)
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
    .withParams(scenarioRestIdParamsSchema)
    .withQuery(scenarioRestListVersionsQuerySchema)
    .withPermission("scenarios:view")
    .withOutput(scenarioRestVersionListResponseSchema)
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
    .withParams(scenarioRestIdVersionParamsSchema)
    .withPermission("scenarios:view")
    .withOutput(scenarioRestVersionDetailResponseSchema)
    .withDocs({
      description:
        "Get one saved version of a scenario, with the name, situation, criteria, labels and parameters as that version saved them.",
      responses: {
        404: {
          description: "Scenario or version not found",
          content: { "application/json": { schema: resolver(scenarioLegacyErrorBodySchema) } },
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
