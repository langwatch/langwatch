/**
 * The `/api/evaluators` REST family: evaluators a project defines, at
 * dated, `latest`, bare and `/api/v1` paths. Dispatches through the
 * feature's application — this file owns the wire contract only.
 */
import {
  badRequestSchema,
  defineRestRouter,
  documentedResponses,
  MANAGEMENT_API_VERSION,
  projectRestFacts,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import {
  apiResponseEvaluatorSchema,
  archivedEvaluatorResponseSchema,
  createEvaluatorInputSchema,
  EvaluatorApi,
  evaluatorIdOrSlugParamsSchema,
  evaluatorIdParamsSchema,
  evaluatorWireSchema,
  EvaluatorNotFoundError,
  EvaluatorTypeImmutableError,
  type EvaluatorWithFields,
  updateEvaluatorInputSchema,
} from "@langwatch/evaluator-contract";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

const logger = createLogger("langwatch:api:evaluators");

const notFound = documentedResponses({ 404: badRequestSchema });
const badRequest = documentedResponses({ 400: badRequestSchema, 404: badRequestSchema });

/** What a route knows about the project behind the credential. */
type ProjectFacts = z.output<typeof projectRestFacts.schema>;

/** One evaluator as the wire publishes it, with its editor address. */
function evaluatorWire(params: {
  app: EvaluatorApi;
  projectSlug: string;
  evaluator: unknown;
}): z.infer<typeof evaluatorWireSchema> {
  const parsed = apiResponseEvaluatorSchema.parse(params.evaluator);

  return {
    ...parsed,
    platformUrl: params.app.platformUrl({
      projectSlug: params.projectSlug,
      path: `/evaluators?drawer.open=evaluatorEditor&drawer.evaluatorId=${parsed.id}`,
    }),
  };
}

/** The row this address names, refusing an evaluator the project does not hold. */
async function readEvaluator(params: {
  app: EvaluatorApi;
  idOrSlug: string;
  projectId: string;
}): Promise<EvaluatorWithFields> {
  const evaluator = await params.app.findByIdOrSlugWithFields({
    idOrSlug: params.idOrSlug,
    projectId: params.projectId,
  });

  if (!evaluator) throw new EvaluatorNotFoundError(params.idOrSlug);

  return evaluator;
}

/**
 * Creates the evaluator against the project's resolved models, then reads it
 * back with the fields its type derives, which is what the wire publishes.
 */
async function createEvaluator(params: {
  app: EvaluatorApi;
  input: z.infer<typeof createEvaluatorInputSchema>;
  project: ProjectFacts;
  projectId: string;
}): Promise<z.infer<typeof evaluatorWireSchema>> {
  const { app, projectId } = params;
  logger.info({ projectId, name: params.input.name }, "Creating evaluator");

  const created = await app.createWithResolvedDefaults({
    projectId,
    name: params.input.name,
    config: params.input.config,
  });
  const enriched = await app.getByIdWithFields({ id: created.id, projectId });
  logger.info({ projectId, evaluatorId: enriched.id }, "Successfully created evaluator");

  return evaluatorWire({
    app,
    projectSlug: params.project.projectSlug,
    evaluator: enriched,
  });
}

/**
 * Applies a partial change, keeping every field the caller did not mention.
 * The evaluator type is fixed at creation: changing it would make every result
 * already stored under it mean something else.
 */
async function updateEvaluator(params: {
  app: EvaluatorApi;
  input: z.infer<typeof evaluatorIdParamsSchema> & z.infer<typeof updateEvaluatorInputSchema>;
  project: ProjectFacts;
  projectId: string;
}): Promise<z.infer<typeof evaluatorWireSchema>> {
  const { app, input, projectId } = params;
  logger.info({ projectId, evaluatorId: input.id }, "Updating evaluator");

  const existing = await app.findById({ id: input.id, projectId });
  if (!existing) throw new EvaluatorNotFoundError(input.id);

  const existingConfig = (existing.config as Record<string, unknown> | null) ?? {};
  const existingType = existingConfig.evaluatorType;
  const changesType =
    input.config?.evaluatorType !== void 0 &&
    typeof existingType === "string" &&
    input.config.evaluatorType !== existingType;

  if (changesType) throw new EvaluatorTypeImmutableError(existingType as string);

  const data: { name?: string; config?: Record<string, unknown> } = {};
  if (input.name !== void 0) data.name = input.name;
  if (input.config !== void 0) data.config = { ...existingConfig, ...input.config };

  const updated = await app.update({ id: input.id, projectId, data });
  const enriched = await app.getByIdWithFields({ id: updated.id, projectId });
  logger.info({ projectId, evaluatorId: enriched.id }, "Successfully updated evaluator");

  return evaluatorWire({
    app,
    projectSlug: params.project.projectSlug,
    evaluator: enriched,
  });
}

/** Archives the evaluator this id names, refusing one the project does not hold. */
async function archiveEvaluator(params: {
  app: EvaluatorApi;
  id: string;
  projectId: string;
}): Promise<z.infer<typeof archivedEvaluatorResponseSchema>> {
  const { app, id, projectId } = params;
  logger.info({ projectId, evaluatorId: id }, "Archiving evaluator");

  const existing = await app.findById({ id, projectId });
  if (!existing) throw new EvaluatorNotFoundError(id);

  await app.archive({ id, projectId });
  logger.info({ projectId, evaluatorId: id }, "Successfully archived evaluator");

  return { success: true };
}

/** The inert declaration a process mounts, once the routes are declared. */
type EvaluatorRestDeclaration = Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<EvaluatorApi>;
}>;

/** The `/api/evaluators` collection and item endpoints. */
export function createEvaluatorRest(): EvaluatorRestDeclaration {
  return (
    defineRestRouter(EvaluatorApi)
      .withNamespace("evaluators")
      .withVersion(MANAGEMENT_API_VERSION)

      .get("/", "getApiEvaluators")
      .withPermission("evaluations:view")
      .withOutput(z.array(evaluatorWireSchema))
      .withDocs({ description: "Get all evaluators for a project" })
      .withMiddleware(projectRestFacts)
      .handle(async ({ app, scope }, project) => {
        logger.info({ projectId: scope.id }, "Getting all evaluators for project");
        const rows = await app.getAllWithFields({ projectId: scope.id });

        return rows.map((evaluator) =>
          evaluatorWire({ app, projectSlug: project.projectSlug, evaluator }),
        );
      })

      .get("/:idOrSlug", "getApiEvaluatorsByIdOrSlug")
      .withParams(evaluatorIdOrSlugParamsSchema)
      .withPermission("evaluations:view")
      .withOutput(evaluatorWireSchema)
      .withDocs({
        description: "Get a specific evaluator by ID or slug",
        responses: notFound,
      })
      .withMiddleware(projectRestFacts)
      .handle(async ({ app, input, scope }, project) => {
        logger.info({ projectId: scope.id, idOrSlug: input.idOrSlug }, "Getting evaluator");

        return evaluatorWire({
          app,
          projectSlug: project.projectSlug,
          evaluator: await readEvaluator({ app, idOrSlug: input.idOrSlug, projectId: scope.id }),
        });
      })

      // Creating asks for `evaluations:create`; `:manage` still implies it, so no
      // existing caller changes and a viewer is declined as before.
      .post("/", "postApiEvaluators")
      .withInput(createEvaluatorInputSchema)
      .withPermission("evaluations:create")
      .withOutput(evaluatorWireSchema)
      .withDocs({ description: "Create a new evaluator" })
      .withMiddleware(projectRestFacts)
      .handle(({ app, input, scope }, project) =>
        createEvaluator({ app, input, project, projectId: scope.id }),
      )

      .put("/:id", "putApiEvaluatorsById")
      .withParams(evaluatorIdParamsSchema)
      .withInput(updateEvaluatorInputSchema)
      .withPermission("evaluations:update")
      .withOutput(evaluatorWireSchema)
      .withDocs({
        description: "Update an existing evaluator",
        responses: badRequest,
      })
      .withMiddleware(projectRestFacts)
      .handle(({ app, input, scope }, project) =>
        updateEvaluator({ app, input, project, projectId: scope.id }),
      )

      // Archiving deliberately stays at `:manage`.
      .delete("/:id", "deleteApiEvaluatorsById")
      .withParams(evaluatorIdParamsSchema)
      .withPermission("evaluations:manage")
      .withOutput(archivedEvaluatorResponseSchema)
      .withDocs({
        description: "Archive (soft-delete) an evaluator",
        responses: notFound,
      })
      .handle(({ app, input, scope }) =>
        archiveEvaluator({ app, id: input.id, projectId: scope.id }),
      )
      .build()
  );
}
