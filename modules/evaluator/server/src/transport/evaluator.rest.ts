/**
 * The `/api/evaluators` REST family: the evaluators a project defines, as the
 * public API publishes them. Dated addressing, so every route answers at its
 * dated path, at `latest`, at the bare path and at the `/api/v1` twin.
 *
 * Every verb dispatches through the feature's application — the same object the
 * tRPC door reaches — and this file owns the wire contract and nothing else.
 */
import {
  badRequestSchema,
  defineRestRouter,
  documentedResponses,
  MANAGEMENT_API_VERSION,
  projectRestFacts,
  type PlatformUrlBuilder,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import {
  EvaluatorApi,
  EvaluatorNotFoundError,
  EvaluatorTypeImmutableError,
  type EvaluatorWithFields,
} from "@langwatch/evaluator-contract";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import {
  apiResponseEvaluatorSchema,
  createEvaluatorInputSchema,
  updateEvaluatorInputSchema,
} from "../rules/evaluator-schemas.rules.ts";

const logger = createLogger("langwatch:api:evaluators");

const evaluatorWireSchema = z.object({
  ...apiResponseEvaluatorSchema.shape,
  platformUrl: z.string().url(),
});

const idParamsSchema = z.object({ id: z.string().min(1).describe("The evaluator id.") });
const idOrSlugParamsSchema = z.object({
  idOrSlug: z.string().min(1).describe("The evaluator id or its project-unique slug."),
});
const archivedSchema = z.object({ success: z.boolean() });

const notFound = documentedResponses({ 404: badRequestSchema });
const badRequest = documentedResponses({ 400: badRequestSchema, 404: badRequestSchema });

/** What a route knows about the project behind the credential. */
type ProjectFacts = z.output<typeof projectRestFacts.schema>;

/** One evaluator as the wire publishes it, with its editor address. */
function evaluatorWire(params: {
  platformUrl: PlatformUrlBuilder;
  projectSlug: string;
  evaluator: unknown;
}): z.infer<typeof evaluatorWireSchema> {
  const parsed = apiResponseEvaluatorSchema.parse(params.evaluator);

  return {
    ...parsed,
    platformUrl: params.platformUrl({
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
  platformUrl: PlatformUrlBuilder;
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
    platformUrl: params.platformUrl,
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
  input: z.infer<typeof idParamsSchema> & z.infer<typeof updateEvaluatorInputSchema>;
  project: ProjectFacts;
  projectId: string;
  platformUrl: PlatformUrlBuilder;
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
    platformUrl: params.platformUrl,
    projectSlug: params.project.projectSlug,
    evaluator: enriched,
  });
}

/** Archives the evaluator this id names, refusing one the project does not hold. */
async function archiveEvaluator(params: {
  app: EvaluatorApi;
  id: string;
  projectId: string;
}): Promise<z.infer<typeof archivedSchema>> {
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
export function createEvaluatorRest(platformUrl: PlatformUrlBuilder): EvaluatorRestDeclaration {
  return (
    defineRestRouter(EvaluatorApi)
      .withNamespace("evaluators")
      .withVersion(MANAGEMENT_API_VERSION)

      .get("/", "listEvaluators")
      .withPermission("evaluations:view")
      .withOutput(z.array(evaluatorWireSchema))
      .withDocs({ description: "Get all evaluators for a project" })
      .withMiddleware(projectRestFacts)
      .handle(async ({ app, scope }, project) => {
        logger.info({ projectId: scope.id }, "Getting all evaluators for project");
        const rows = await app.getAllWithFields({ projectId: scope.id });

        return rows.map((evaluator) =>
          evaluatorWire({ platformUrl, projectSlug: project.projectSlug, evaluator }),
        );
      })

      .get("/:idOrSlug", "getEvaluator")
      .withParams(idOrSlugParamsSchema)
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
          platformUrl,
          projectSlug: project.projectSlug,
          evaluator: await readEvaluator({ app, idOrSlug: input.idOrSlug, projectId: scope.id }),
        });
      })

      // Creating asks for `evaluations:create`; `:manage` still implies it, so no
      // existing caller changes and a viewer is declined as before.
      .post("/", "createEvaluator")
      .withInput(createEvaluatorInputSchema)
      .withPermission("evaluations:create")
      .withOutput(evaluatorWireSchema)
      .withDocs({ description: "Create a new evaluator" })
      .withMiddleware(projectRestFacts)
      .handle(({ app, input, scope }, project) =>
        createEvaluator({ app, input, project, projectId: scope.id, platformUrl }),
      )

      .put("/:id", "updateEvaluator")
      .withParams(idParamsSchema)
      .withInput(updateEvaluatorInputSchema)
      .withPermission("evaluations:update")
      .withOutput(evaluatorWireSchema)
      .withDocs({
        description: "Update an existing evaluator",
        responses: badRequest,
      })
      .withMiddleware(projectRestFacts)
      .handle(({ app, input, scope }, project) =>
        updateEvaluator({ app, input, project, projectId: scope.id, platformUrl }),
      )

      // Archiving deliberately stays at `:manage`.
      .delete("/:id", "archiveEvaluator")
      .withParams(idParamsSchema)
      .withPermission("evaluations:manage")
      .withOutput(archivedSchema)
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
