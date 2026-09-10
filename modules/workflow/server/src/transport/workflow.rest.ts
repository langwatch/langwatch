/**
 * The `/api/workflows` CRUD family, dated, as the public API publishes it. The
 * Studio's own two doors are a separate family the process mounts ahead of
 * this one, so their literal paths win over `/:id`.
 */
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectRestFacts,
  type PlatformUrlBuilder,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import {
  WorkflowApi,
  WorkflowNotFoundError,
  workflowRestArchivedSchema,
  workflowRestDetailSchema,
  workflowRestEvaluateSchema,
  workflowRestEvaluationStartedSchema,
  workflowRestParamsSchema,
  workflowRestRefusalSchema,
  workflowRestUpdateSchema,
  type Workflow,
  type WorkflowEvaluationRequest,
  type WorkflowRestDetail,
  type WorkflowRestUpdate,
} from "@langwatch/workflow-contract";
import { z } from "zod";

const logger = createLogger("langwatch:api:workflows");

/**
 * Whether the key may also READ the run it is about to start. A fact rather
 * than a second declared permission, because a route declares one permission
 * and the caller polls the run behind `evaluations:view`.
 */
export const workflowEvaluationRunCeiling = defineRestMiddleware(
  "workflowEvaluationRunCeiling",
  z.boolean(),
);

function toWorkflowResponse(workflow: Workflow) {
  return {
    id: workflow.id,
    name: workflow.name,
    icon: workflow.icon,
    description: workflow.description,
    isEvaluator: workflow.isEvaluator,
    isComponent: workflow.isComponent,
    createdAt: workflow.createdAt.toISOString(),
    updatedAt: workflow.updatedAt.toISOString(),
  };
}

/** The 404 body a workflow this project does not hold has always answered. */
const NOT_FOUND = { status: 404, body: { error: "Workflow not found" } } as const;

/**
 * The refusals the evaluations pipeline names for itself, each a handled error
 * carrying the status it is owed, published in the bare `{ error }` body.
 */
function evaluationRefusalOf(
  error: unknown,
): Readonly<{ status: 400 | 404; body: { error: string } }> | null {
  if (!HandledError.isHandled(error)) return null;

  if (error.httpStatus === 404) return { status: 404, body: { error: error.message } };
  if (error.httpStatus === 400) return { status: 400, body: { error: error.message } };

  return null;
}

/** How a route reaches the studio address of one workflow. */
type StudioUrl = (projectSlug: string, workflowId: string) => string;

/** The row this address names, or the 404 a project that does not hold it answers. */
async function readWorkflow(params: {
  app: WorkflowApi;
  id: string;
  projectId: string;
  projectSlug: string;
  studioUrl: StudioUrl;
}): Promise<Readonly<{ status: 200; body: WorkflowRestDetail }> | typeof NOT_FOUND> {
  try {
    const workflow = await params.app.getById({ id: params.id, projectId: params.projectId });

    return { status: 200, body: wireOf({ workflow, ...params }) };
  } catch (error) {
    return notFoundOr(error);
  }
}

/** A partial change to a workflow's own metadata, applied in its project. */
async function writeWorkflow(params: {
  app: WorkflowApi;
  id: string;
  projectId: string;
  projectSlug: string;
  studioUrl: StudioUrl;
  changes: WorkflowRestUpdate;
}): Promise<Readonly<{ status: 200; body: WorkflowRestDetail }> | typeof NOT_FOUND> {
  const { app, id, projectId } = params;

  try {
    await app.assertInProject({ workflowId: id, projectId });

    const workflow = await app.update({ id, projectId, ...params.changes });

    return { status: 200, body: wireOf({ workflow, ...params }) };
  } catch (error) {
    return notFoundOr(error);
  }
}

/** The soft delete, answered with the id it archived. */
async function archiveWorkflow(params: {
  app: WorkflowApi;
  id: string;
  projectId: string;
}): Promise<
  Readonly<{ status: 200; body: { id: string; archived: boolean } }> | typeof NOT_FOUND
> {
  try {
    await params.app.archive({ id: params.id, projectId: params.projectId });

    return { status: 200, body: { id: params.id, archived: true } };
  } catch (error) {
    return notFoundOr(error);
  }
}

/** One evaluation run started, or the refusal the pipeline named for it. */
async function startEvaluation(params: {
  app: WorkflowApi;
  request: WorkflowEvaluationRequest;
}): Promise<
  | Readonly<{ status: 200; body: z.infer<typeof workflowRestEvaluationStartedSchema> }>
  | Readonly<{ status: 400 | 404; body: { error: string } }>
> {
  try {
    const started = await params.app.triggerEvaluation(params.request);

    return {
      status: 200,
      body: {
        run_id: started.runId,
        run_url: started.runUrl,
        workflow_version_id: started.workflowVersionId,
        version: started.version,
      },
    };
  } catch (error) {
    const refusal = evaluationRefusalOf(error);

    if (refusal) return refusal;

    return notFoundOr(error);
  }
}

/** A workflow the project does not hold reads as a 404; anything else is a fault. */
function notFoundOr(error: unknown): typeof NOT_FOUND {
  if (error instanceof WorkflowNotFoundError) return NOT_FOUND;

  throw error;
}

function wireOf(params: {
  workflow: Workflow;
  projectSlug: string;
  studioUrl: StudioUrl;
}): WorkflowRestDetail {
  return {
    ...toWorkflowResponse(params.workflow),
    platformUrl: params.studioUrl(params.projectSlug, params.workflow.id),
  };
}

export type WorkflowRestDeclaration = Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<WorkflowApi>;
}>;

/** The `/api/workflows` collection and item endpoints. */
export function createWorkflowRest(platformUrl: PlatformUrlBuilder): WorkflowRestDeclaration {
  const studioUrl = (projectSlug: string, workflowId: string) =>
    platformUrl({ projectSlug, path: `/studio/${workflowId}` });

  return (
    defineRestRouter(WorkflowApi)
      .withNamespace("workflows")
      .withVersion(MANAGEMENT_API_VERSION)
      .withCredential("project")

      .get("/", "listWorkflows")
      .withPermission("workflows:view")
      .withOutput(z.array(workflowRestDetailSchema))
      .withDocs({ description: "List all non-archived workflows for the project" })
      .withMiddleware(projectRestFacts)
      .handle(async ({ app, scope }, project) => {
        logger.info({ projectId: scope.id }, "Listing workflows");
        const listed = await app.list({ projectId: scope.id });

        return listed.map((workflow) => ({
          ...toWorkflowResponse(workflow),
          platformUrl: studioUrl(project.projectSlug, workflow.id),
        }));
      })

      .get("/:id", "getWorkflow")
      .withParams(workflowRestParamsSchema)
      .withPermission("workflows:view")
      .responds({ 200: workflowRestDetailSchema, 404: workflowRestRefusalSchema })
      .withDocs({ description: "Get a workflow by its ID" })
      .withMiddleware(projectRestFacts)
      .handle(({ app, input, scope }, project) => {
        logger.info({ projectId: scope.id, workflowId: input.id }, "Getting workflow");

        return readWorkflow({
          app,
          id: input.id,
          projectId: scope.id,
          projectSlug: project.projectSlug,
          studioUrl,
        });
      })

      // Editing metadata on a workflow that already exists is an `:update`.
      // `:manage` still implies it, so no existing caller changes.
      .patch("/:id", "updateWorkflow")
      .withParams(workflowRestParamsSchema)
      .withInput(workflowRestUpdateSchema)
      .withPermission("workflows:update")
      .responds({ 200: workflowRestDetailSchema, 404: workflowRestRefusalSchema })
      .withDocs({ description: "Update a workflow's metadata (name, icon, description)" })
      .withMiddleware(projectRestFacts)
      .handle(({ app, input, scope }, project) => {
        const { id, ...changes } = input;
        logger.info({ projectId: scope.id, workflowId: id }, "Updating workflow");

        return writeWorkflow({
          app,
          id,
          projectId: scope.id,
          projectSlug: project.projectSlug,
          studioUrl,
          changes,
        });
      })

      // Archiving deliberately stays at `:manage`.
      .delete("/:id", "archiveWorkflow")
      .withParams(workflowRestParamsSchema)
      .withPermission("workflows:manage")
      .responds({ 200: workflowRestArchivedSchema, 404: workflowRestRefusalSchema })
      .withDocs({ description: "Archive (soft-delete) a workflow" })
      .handle(({ app, input, scope }) => {
        logger.info({ projectId: scope.id, workflowId: input.id }, "Archiving workflow");

        return archiveWorkflow({ app, id: input.id, projectId: scope.id });
      })

      // Running a workflow is not administering it: the committed version, its
      // nodes and its dataset are untouched - the call produces a RUN. So it
      // asks for `workflows:create`, the same grain as the suite run. The
      // second gate is the ceiling fact above: the caller must also be able to
      // READ the run it starts.
      .post("/:id/evaluate", "evaluateWorkflow")
      .withParams(workflowRestParamsSchema)
      .withInput(workflowRestEvaluateSchema)
      .withPermission("workflows:create")
      .responds({
        200: workflowRestEvaluationStartedSchema,
        400: workflowRestRefusalSchema,
        403: workflowRestRefusalSchema,
        404: workflowRestRefusalSchema,
      })
      .withDocs({
        description:
          "Trigger an evaluation run of a workflow's committed version through " +
          "the evaluations pipeline. Evaluate the workflow's attached dataset, " +
          "inline data, or a platform dataset id; parameters bind as constant " +
          "entry inputs on every row. Returns a run id and a results URL to poll " +
          "or open in the browser.",
      })
      .withMiddleware(projectRestFacts, workflowEvaluationRunCeiling)
      .handle(({ app, input, scope }, project, mayReadRuns) => {
        if (!mayReadRuns) {
          return { status: 403, body: { error: "This key cannot read evaluation runs" } } as const;
        }

        logger.info(
          { projectId: scope.id, workflowId: input.id },
          "Triggering workflow evaluation via API",
        );

        return startEvaluation({
          app,
          request: {
            projectId: scope.id,
            projectSlug: project.projectSlug,
            workflowId: input.id,
            versionId: input.version_id,
            data: input.data,
            datasetId: input.dataset_id,
            parameters: input.parameters,
            rowIndices: input.row_indices,
          },
        });
      })
      .build()
  );
}
