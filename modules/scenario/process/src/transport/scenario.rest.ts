import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectRestFacts,
  resolver,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
/**
 * `/api/scenarios`: scenarios and version history (resolves platformUrl).
 * Answers misses in legacy `{ error }` body; scenarioRestErrorHandler is mount's onError.
 */
import { createLogger } from "@langwatch/observability";
import {
  parseScenarioParameterDefinitions,
  ScenarioApi,
  ScenarioNotFoundError,
  type Scenario,
  type ScenarioParameterDefinition,
  scenarioLegacyErrorBodySchema,
  scenarioRestResponseWithPlatformUrlSchema,
  scenarioRestVersionListResponseSchema,
  scenarioRestVersionDetailResponseSchema,
  scenarioRestListVersionsQuerySchema,
  scenarioRestCreateSchema,
  scenarioRestUpdateSchema,
  scenarioRestIdParamsSchema,
  scenarioRestIdVersionParamsSchema,
  scenarioRestArchivedSchema,
} from "@langwatch/scenario-contract";
import { z } from "zod";

const logger = createLogger("langwatch:api:scenarios");

/**
 * The surface a write declares itself through, off the X-LangWatch-Surface
 * header. Only "cli" is honoured; every other value, absent included, reads
 * as "api", so a caller cannot claim an in-process surface over the wire.
 */
export const scenarioRestSurface = defineRestMiddleware(
  "scenarioRestSurface",
  z.string().nullable(),
);

/** The version history's author label for a REST write, off its declared surface. */
function scenarioAuthorLabel(surface: string | null): "cli" | "api" {
  return surface?.toLowerCase() === "cli" ? "cli" : "api";
}

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

function toScenarioResponse(scenario: Scenario): {
  id: string;
  name: string;
  situation: string;
  criteria: string[];
  labels: string[];
  parameters: ScenarioParameterDefinition[];
  simulatorModel: string | null;
  judgeModel: string | null;
  maxTurns: number | null;
  minTurns: number | null;
  testSuiteId: string | null;
  fields: Scenario["fields"];
} {
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
    fields: scenario.fields,
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
 * history. `platformUrl` is resolved through `ScenarioApi.platformUrl`.
 */
export function createScenarioRest(): Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<ScenarioApi>;
}> {
  const withPlatformUrl = (app: ScenarioApi, scenario: Scenario, projectSlug: string) => ({
    ...toScenarioResponse(scenario),
    platformUrl: app.platformUrl({ projectSlug, path: scenarioEditorPath(scenario.id) }),
  });

  return (
    defineRestRouter(ScenarioApi)
      .withNamespace("scenarios")
      .withVersion(MANAGEMENT_API_VERSION)

      /** List every scenario in the project. */
      .get("/", "getApiScenarios")
      .withPermission("scenarios:view")
      .withOutput(z.array(scenarioRestResponseWithPlatformUrlSchema))
      .withDocs({ description: "Get all scenarios for a project" })
      .withMiddleware(projectRestFacts)
      .handle(async ({ app, scope }, project) => {
        logger.info({ projectId: scope.id }, "Listing scenarios");
        const listed = await app.list({ projectId: scope.id });
        return listed.map((s) => withPlatformUrl(app, s, project.projectSlug));
      })

      /** Read one scenario by id. */
      .get("/:scenarioId", "getApiScenariosById")
      .withParams(scenarioRestIdParamsSchema)
      .withPermission("scenarios:view")
      .withOutput(scenarioRestResponseWithPlatformUrlSchema)
      .withDocs({
        description: "Get a specific scenario by ID",
        responses: scenarioNotFoundResponse,
      })
      .withMiddleware(projectRestFacts)
      .handle(async ({ app, input, scope }, project) => {
        logger.info({ projectId: scope.id, scenarioId: input.scenarioId }, "Getting scenario");
        const scenario = await app.tryGetById({ id: input.scenarioId, projectId: scope.id });
        if (!scenario) throw new ScenarioNotFoundError(input.scenarioId);
        return withPlatformUrl(app, scenario, project.projectSlug);
      })

      // Creating asks for `scenarios:create`, not `scenarios:manage`. Nobody
      // loses access: `:manage` implies `:create`, so every role and key that
      // could create a scenario yesterday still can. What changes is that access
      // granted at the CREATE grain now works.
      .post("/", "postApiScenarios")
      .withInput(scenarioRestCreateSchema)
      .withPermission("scenarios:create")
      .withOutput(scenarioRestResponseWithPlatformUrlSchema)
      .withStatus(201)
      .withDocs({ description: "Create a new scenario" })
      .withMiddleware(projectRestFacts, scenarioRestSurface)
      .handle(async ({ app, input: body, scope }, project, surface) => {
        logger.info({ projectId: scope.id }, "Creating scenario");
        const label = scenarioAuthorLabel(surface);
        const scenario = await app.create(
          {
            projectId: scope.id,
            name: body.name,
            situation: body.situation,
            criteria: body.criteria,
            labels: body.labels,
            // `viewerUserId` is null for a credential that names no person (a
            // legacy project key). Naming that explicitly here is what lets the
            // app write NULL to `lastUpdatedById` instead of the project id -
            // the id the door falls back to for a key with nobody behind it,
            // which does not exist as a `User` row and violates its FK.
            actor: { userId: project.viewerUserId, label },
            ...(body.parameters !== undefined && { parameters: body.parameters }),
            ...(body.simulatorModel !== undefined && { simulatorModel: body.simulatorModel }),
            ...(body.judgeModel !== undefined && { judgeModel: body.judgeModel }),
            ...(body.maxTurns !== undefined && { maxTurns: body.maxTurns }),
            ...(body.minTurns !== undefined && { minTurns: body.minTurns }),
            ...(body.testSuiteId !== undefined && { testSuiteId: body.testSuiteId }),
            ...(body.fields !== undefined && { fields: body.fields }),
          },
          { id: project.actorId, label },
        );
        return withPlatformUrl(app, scenario, project.projectSlug);
      })

      /**
       * Update a scenario in place. PUT and PATCH register the same handler:
       * both apply a partial update, so a client using either verb gets the
       * same behavior instead of a 404 on one of them.
       */
      .put("/:scenarioId", "putApiScenariosById")
      .withParams(scenarioRestIdParamsSchema)
      .withInput(scenarioRestUpdateSchema)
      .withPermission("scenarios:update")
      .withOutput(scenarioRestResponseWithPlatformUrlSchema)
      .withDocs({ description: "Update an existing scenario", responses: scenarioNotFoundResponse })
      .withMiddleware(projectRestFacts, scenarioRestSurface)
      .handle(async ({ app, input, scope }, project, surface) => {
        const { scenarioId: id, ...body } = input;
        logger.info({ projectId: scope.id, scenarioId: id }, "Updating scenario");

        const existing = await app.tryGetById({ id, projectId: scope.id });
        if (!existing) throw new ScenarioNotFoundError(id);

        const scenario = await app.update(
          { id, projectId: scope.id, ...scenarioUpdateData(body) },
          { id: project.actorId, label: scenarioAuthorLabel(surface) },
        );
        return withPlatformUrl(app, scenario, project.projectSlug);
      })

      .patch("/:scenarioId", "patchApiScenariosById")
      .withParams(scenarioRestIdParamsSchema)
      .withInput(scenarioRestUpdateSchema)
      .withPermission("scenarios:update")
      .withOutput(scenarioRestResponseWithPlatformUrlSchema)
      .withDocs({ description: "Update an existing scenario", responses: scenarioNotFoundResponse })
      .withMiddleware(projectRestFacts, scenarioRestSurface)
      .handle(async ({ app, input, scope }, project, surface) => {
        const { scenarioId: id, ...body } = input;
        logger.info({ projectId: scope.id, scenarioId: id }, "Updating scenario");

        const existing = await app.tryGetById({ id, projectId: scope.id });
        if (!existing) throw new ScenarioNotFoundError(id);

        const scenario = await app.update(
          { id, projectId: scope.id, ...scenarioUpdateData(body) },
          { id: project.actorId, label: scenarioAuthorLabel(surface) },
        );
        return withPlatformUrl(app, scenario, project.projectSlug);
      })

      // Archiving deliberately still asks for `:manage`. Create and update were
      // refined because access issued at that grain was being refused; nothing
      // is asking to destroy scenarios at a finer grain.
      .delete("/:scenarioId", "deleteApiScenariosById")
      .withParams(scenarioRestIdParamsSchema)
      .withPermission("scenarios:manage")
      .withOutput(scenarioRestArchivedSchema)
      .withDocs({
        description: "Archive (soft-delete) a scenario",
        responses: scenarioNotFoundResponse,
      })
      .handle(async ({ app, input, scope }) => {
        const { scenarioId: id } = input;
        logger.info({ projectId: scope.id, scenarioId: id }, "Archiving scenario");
        await app.archive({ id, projectId: scope.id });
        return { id, archived: true };
      })

      /** The version history of a scenario, newest first. */
      .get("/:scenarioId/versions", "getApiScenariosByIdVersions")
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
        const { scenarioId: id, limit, cursor } = input;
        logger.info({ projectId: scope.id, scenarioId: id }, "Listing scenario versions");
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
      })

      /**
       * One version of a scenario with the content it saved. A version number
       * that names nothing refuses `scenario_version_not_found`, the same
       * code the synthesized Created entry answers: it has no stored snapshot.
       */
      .get("/:scenarioId/versions/:version", "getApiScenariosByIdVersionsByVersion")
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
        const { scenarioId: id, version } = input;
        logger.info({ projectId: scope.id, scenarioId: id, version }, "Getting scenario version");
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
      })

      .build()
  );
}
