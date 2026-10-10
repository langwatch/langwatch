/**
 * `POST /api/workflows/:id/evaluate`, served by experiment in workflow's
 * namespace: the run belongs to experiment, the address to the public API.
 * Spec: modules/experiment/specs/workflow-evaluation-trigger.feature.
 */
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectRequestContext,
} from "@langwatch/api/rest";
import {
  ExperimentApi,
  experimentWorkflowEvaluateParamsSchema,
  experimentWorkflowEvaluateSchema,
  experimentWorkflowEvaluationStartedSchema,
} from "@langwatch/experiment-contract";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:api:workflows");

/** The evaluate door kept its path in workflow's namespace (§8, R10). */
const WORKFLOW_NAMESPACE = {
  owner: "workflow",
  reason: "released SDKs and snippets call the workflow evaluate door at its original path",
  deprecate: "move under a namespace experiment owns in the next API version",
} as const;

// Running a workflow is not administering it: the call produces a RUN. So it
// asks for `workflows:create`, the same grain as the suite run, and
// `evaluations:view` after it: the caller must also be able to READ the run.
export const experimentWorkflowEvaluationRest = defineRestRouter(ExperimentApi)
  .withNamespace("workflows")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("project")

  .post("/:id/evaluate", "postApiWorkflowsByIdEvaluate")
  .withSharedPath(WORKFLOW_NAMESPACE)
  .withParams(experimentWorkflowEvaluateParamsSchema)
  .withInput(experimentWorkflowEvaluateSchema)
  .withPermission(["workflows:create", "evaluations:view"])
  .withOutput(experimentWorkflowEvaluationStartedSchema)
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
  .withMiddlewareContext(projectRequestContext)
  .handle(async ({ app, input, scope }, project) => {
    logger.info(
      { projectId: scope.id, workflowId: input.id },
      "Triggering workflow evaluation via API",
    );

    const started = await app.triggerWorkflowEvaluation({
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
  .build();
