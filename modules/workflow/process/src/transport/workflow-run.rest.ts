import { PayloadTooLargeError } from "@langwatch/api";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import { resolveRequestBound } from "@langwatch/plans";
import {
  workflowRunAnswerSchema,
  workflowRunRestBodySchema,
  workflowRunRestParamsSchema,
  workflowRunRestVersionedParamsSchema,
  WorkflowApi,
} from "@langwatch/workflow-contract";

const BODY_LIMIT_JSON_BYTES = resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE");
const bodyLimit = {
  maxBytes: BODY_LIMIT_JSON_BYTES,
  onExceeded: () => new PayloadTooLargeError(),
} as const;

export const workflowRunRest = defineRestRouter(WorkflowApi)
  .withNamespace("workflow-run")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("project")
  .withAddressing("literal", { v1Twin: true })

  .post("/api/optimization/:workflowId/:versionId", "postApiOptimizationByWorkflowIdByVersionId")
  .withParams(workflowRunRestVersionedParamsSchema)
  .withInput(workflowRunRestBodySchema)
  .withBodyLimit(bodyLimit)
  .withPermission("workflows:manage")
  .withOutput(workflowRunAnswerSchema)
  .withDocs({
    summary: "Run a workflow version (legacy path)",
    description:
      "Run one pinned version of an Optimization Studio workflow synchronously. Identical to " +
      "`POST /api/workflows/{workflowId}/{versionId}/run`, which is the path to use in new " +
      "integrations; this one stays for callers written against it. The body is the workflow's " +
      "own input fields, named as its entry node names them.",
    tags: ["Workflows"],
    requestBody: { schema: workflowRunRestBodySchema },
  })
  .handle(({ app, input, scope }) => {
    const { workflowId, versionId, ...inputs } = input;

    return app.runSynchronous({ workflowId, versionId, projectId: scope.id, inputs });
  })

  .post("/api/workflows/:workflowId/run", "postApiWorkflowsByWorkflowIdRun")
  .withParams(workflowRunRestParamsSchema)
  .withInput(workflowRunRestBodySchema)
  .withBodyLimit(bodyLimit)
  .withPermission("workflows:manage")
  .withOutput(workflowRunAnswerSchema)
  .withDocs({
    summary: "Run a workflow",
    description:
      "Run an Optimization Studio workflow synchronously and return its output. Runs the " +
      "workflow's published version; address a specific version with the `{versionId}` form of " +
      "this path. The body is the workflow's own input fields, named as its entry node names them.",
    tags: ["Workflows"],
    requestBody: { schema: workflowRunRestBodySchema },
  })
  .handle(({ app, input, scope }) => {
    const { workflowId, ...inputs } = input;

    return app.runSynchronous({ workflowId, projectId: scope.id, inputs });
  })

  .post("/api/workflows/:workflowId/:versionId/run", "postApiWorkflowsByWorkflowIdByVersionIdRun")
  .withParams(workflowRunRestVersionedParamsSchema)
  .withInput(workflowRunRestBodySchema)
  .withBodyLimit(bodyLimit)
  .withPermission("workflows:manage")
  .withOutput(workflowRunAnswerSchema)
  .withDocs({
    summary: "Run a specific workflow version",
    description:
      "Run one pinned version of an Optimization Studio workflow synchronously and return its " +
      "output. Use this when a caller must keep hitting the same version as the workflow is " +
      "edited. The body is the workflow's own input fields, named as its entry node names them.",
    tags: ["Workflows"],
    requestBody: { schema: workflowRunRestBodySchema },
  })
  .handle(({ app, input, scope }) => {
    const { workflowId, versionId, ...inputs } = input;

    return app.runSynchronous({ workflowId, versionId, projectId: scope.id, inputs });
  })
  .build();
