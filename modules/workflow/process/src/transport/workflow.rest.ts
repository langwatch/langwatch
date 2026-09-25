import { ApiKeyPermissionDeniedError } from "@langwatch/api-key-contract";
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
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import {
  WorkflowApi,
  workflowRestArchivedSchema,
  workflowRestDetailSchema,
  workflowRestEvaluateSchema,
  workflowRestEvaluationStartedSchema,
  workflowRestParamsSchema,
  workflowRestUpdateSchema,
  type Workflow,
  type WorkflowRestDetail,
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

function toWorkflowResponse(workflow: Workflow): Omit<WorkflowRestDetail, "platformUrl"> {
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

/** Where one workflow opens in the Studio. */
function studioUrl(app: WorkflowApi, projectSlug: string, workflowId: string): string {
  return app.platformUrl({ projectSlug, path: `/studio/${workflowId}` });
}

function wireOf(params: {
  app: WorkflowApi;
  workflow: Workflow;
  projectSlug: string;
}): WorkflowRestDetail {
  return {
    ...toWorkflowResponse(params.workflow),
    platformUrl: studioUrl(params.app, params.projectSlug, params.workflow.id),
  };
}

export type WorkflowRestDeclaration = Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<WorkflowApi>;
}>;

/** The `/api/workflows` collection and item endpoints. */
export function createWorkflowRest(): WorkflowRestDeclaration {
  return (
    defineRestRouter(WorkflowApi)
      .withNamespace("workflows")
      .withVersion(MANAGEMENT_API_VERSION)
      .withCredential("project")

      .get("/", "getApiWorkflows")
      .withPermission("workflows:view")
      .withOutput(z.array(workflowRestDetailSchema))
      .withDocs({ description: "List all non-archived workflows for the project" })
      .withMiddleware(projectRestFacts)
      .handle(async ({ app, scope }, project) => {
        logger.info({ projectId: scope.id }, "Listing workflows");
        const listed = await app.list({ projectId: scope.id });

        return listed.map((workflow) => ({
          ...toWorkflowResponse(workflow),
          platformUrl: studioUrl(app, project.projectSlug, workflow.id),
        }));
      })

      .get("/:id", "getApiWorkflowsById")
      .withParams(workflowRestParamsSchema)
      .withPermission("workflows:view")
      .withOutput(workflowRestDetailSchema)
      .withDocs({
        description: "Get a workflow by its ID",
        errors: [{ status: 404, description: "The project holds no workflow with this id" }],
      })
      .withMiddleware(projectRestFacts)
      .handle(async ({ app, input, scope }, project) => {
        logger.info({ projectId: scope.id, workflowId: input.id }, "Getting workflow");
        const workflow = await app.getById({ id: input.id, projectId: scope.id });

        return wireOf({ app, workflow, projectSlug: project.projectSlug });
      })

      // Editing metadata on a workflow that already exists is an `:update`.
      // `:manage` still implies it, so no existing caller changes.
      .patch("/:id", "patchApiWorkflowsById")
      .withParams(workflowRestParamsSchema)
      .withInput(workflowRestUpdateSchema)
      .withPermission("workflows:update")
      .withOutput(workflowRestDetailSchema)
      .withDocs({
        description: "Update a workflow's metadata (name, icon, description)",
        errors: [{ status: 404, description: "The project holds no workflow with this id" }],
      })
      .withMiddleware(projectRestFacts)
      .handle(async ({ app, input, scope }, project) => {
        const { id, ...changes } = input;
        logger.info({ projectId: scope.id, workflowId: id }, "Updating workflow");
        await app.assertInProject({ workflowId: id, projectId: scope.id });
        const workflow = await app.update({ id, projectId: scope.id, ...changes });

        return wireOf({ app, workflow, projectSlug: project.projectSlug });
      })

      // Archiving deliberately stays at `:manage`.
      .delete("/:id", "deleteApiWorkflowsById")
      .withParams(workflowRestParamsSchema)
      .withPermission("workflows:manage")
      .withOutput(workflowRestArchivedSchema)
      .withDocs({
        description: "Archive (soft-delete) a workflow",
        errors: [{ status: 404, description: "The project holds no workflow with this id" }],
      })
      .handle(async ({ app, input, scope }) => {
        logger.info({ projectId: scope.id, workflowId: input.id }, "Archiving workflow");
        await app.archive({ id: input.id, projectId: scope.id });

        return { id: input.id, archived: true };
      })

      // Running a workflow is not administering it: the committed version, its
      // nodes and its dataset are untouched - the call produces a RUN. So it
      // asks for `workflows:create`, the same grain as the suite run. The
      // second gate is the ceiling fact above: the caller must also be able to
      // READ the run it starts.
      .post("/:id/evaluate", "postApiWorkflowsByIdEvaluate")
      .withParams(workflowRestParamsSchema)
      .withInput(workflowRestEvaluateSchema)
      .withPermission("workflows:create")
      .withOutput(workflowRestEvaluationStartedSchema)
      .withDocs({
        description:
          "Trigger an evaluation run of a workflow's committed version through " +
          "the evaluations pipeline. Evaluate the workflow's attached dataset, " +
          "inline data, or a platform dataset id; parameters bind as constant " +
          "entry inputs on every row. Returns a run id and a results URL to poll " +
          "or open in the browser.",
        errors: [
          {
            status: 400,
            description: "The workflow has no committed version, or the run could not start",
          },
          { status: 403, description: "The API key cannot read the evaluation run it would start" },
          { status: 404, description: "The project holds no such workflow or dataset" },
          { status: 422, description: "The body failed validation" },
        ],
      })
      .withMiddleware(projectRestFacts, workflowEvaluationRunCeiling)
      .handle(async ({ app, input, scope }, project, mayReadRuns) => {
        if (!mayReadRuns) throw new ApiKeyPermissionDeniedError("evaluations:view");

        logger.info(
          { projectId: scope.id, workflowId: input.id },
          "Triggering workflow evaluation via API",
        );

        const started = await app.triggerEvaluation({
          projectId: scope.id,
          projectSlug: project.projectSlug,
          workflowId: input.id,
          versionId: input.version_id,
          data: input.data,
          datasetId: input.dataset_id,
          parameters: input.parameters,
          rowIndices: input.row_indices,
        });

        return {
          run_id: started.runId,
          run_url: started.runUrl,
          workflow_version_id: started.workflowVersionId,
          version: started.version,
        };
      })
      .build()
  );
}
