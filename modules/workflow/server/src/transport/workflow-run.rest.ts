/**
 * The three URLs a synchronous Optimization Studio run is started from, served
 * by ONE handler: the legacy path once carried its own copy and the two had
 * drifted. Literal, because twenty other families share their prefix.
 */
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import { NotFoundError, ValidationError } from "@langwatch/handled-error";
import {
  workflowRunAnswerSchema,
  workflowRunRestBodySchema,
  workflowRunRestParamsSchema,
  workflowRunRestRefusalSchema,
  workflowRunRestVersionedParamsSchema,
  WorkflowApi,
  WorkflowNotFoundError,
  WorkflowNotPublishedError,
  WorkflowVersionNotFoundError,
} from "@langwatch/workflow-contract";
import { z } from "zod";

/**
 * The media type this request was sent as. A fact rather than a parsed body:
 * the run's body is the workflow's own entry fields, so nothing validates it,
 * and refusing a form post is a sentence an SDK already parses.
 */
export const workflowRunContentType = defineRestMiddleware(
  "workflowRunContentType",
  z.string().nullable(),
);

/** One run, whichever of the three addresses asked for it. */
async function runWorkflow({
  app,
  projectId,
  workflowId,
  versionId,
  contentType,
  raw,
}: {
  app: WorkflowApi;
  projectId: string;
  workflowId: string;
  versionId?: string | undefined;
  contentType: string | null;
  raw: string;
}) {
  if (!contentType?.includes("application/json")) {
    return { status: 400, body: { message: "Invalid body, expecting json" } } as const;
  }

  let body: Record<string, unknown>;

  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { status: 400, body: { message: "Invalid body" } } as const;
  }

  // Failures propagate to the family's error boundary, which already maps a
  // handled error to its own status. Catching here and hard-coding 500 was
  // what masked all three of the named refusals below as raw 500s.
  try {
    const answer = await app.run({
      workflowId,
      projectId,
      inputs: body,
      ...(versionId ? { versionId } : {}),
    });

    return { status: 200, body: answer } as const;
  } catch (error) {
    throw namedRefusalFor({ error, workflowId });
  }
}

/**
 * The three refusals a caller acts on differently: a workflow that does not
 * exist, one that was never published, and a pinned version that was never
 * committed. Each keeps its own code rather than collapsing into one.
 */
function namedRefusalFor({ error, workflowId }: { error: unknown; workflowId: string }): unknown {
  if (error instanceof WorkflowNotFoundError) {
    return new NotFoundError("workflow_not_found", "Workflow", workflowId);
  }

  if (error instanceof WorkflowNotPublishedError) {
    return new ValidationError("Workflow not published", { meta: { workflowId } });
  }

  if (error instanceof WorkflowVersionNotFoundError) {
    return new NotFoundError(
      "published_workflow_version_not_found",
      "Published workflow version",
      error.versionId,
    );
  }

  return error;
}

export const workflowRunRest = defineRestRouter(WorkflowApi)
  .withNamespace("workflow-run")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("project")
  .withAddressing("literal", { v1Twin: false })

  .post("/api/optimization/:workflowId/:versionId", "runOptimizationWorkflowVersion")
  .withParams(workflowRunRestVersionedParamsSchema)
  .withRawBody("text", { mediaType: "application/json" })
  .withPermission("workflows:manage")
  .responds({ 200: workflowRunAnswerSchema, 400: workflowRunRestRefusalSchema })
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
  .withMiddleware(workflowRunContentType)
  .handle(({ app, input, scope, raw }, contentType) =>
    runWorkflow({
      app,
      projectId: scope.id,
      workflowId: input.workflowId,
      versionId: input.versionId,
      contentType,
      raw,
    }),
  )

  .post("/api/workflows/:workflowId/run", "runWorkflow")
  .withParams(workflowRunRestParamsSchema)
  .withRawBody("text", { mediaType: "application/json" })
  .withPermission("workflows:manage")
  .responds({ 200: workflowRunAnswerSchema, 400: workflowRunRestRefusalSchema })
  .withDocs({
    summary: "Run a workflow",
    description:
      "Run an Optimization Studio workflow synchronously and return its output. Runs the " +
      "workflow's published version; address a specific version with the `{versionId}` form of " +
      "this path. The body is the workflow's own input fields, named as its entry node names them.",
    tags: ["Workflows"],
    requestBody: { schema: workflowRunRestBodySchema },
  })
  .withMiddleware(workflowRunContentType)
  .handle(({ app, input, scope, raw }, contentType) =>
    runWorkflow({
      app,
      projectId: scope.id,
      workflowId: input.workflowId,
      contentType,
      raw,
    }),
  )

  .post("/api/workflows/:workflowId/:versionId/run", "runWorkflowVersion")
  .withParams(workflowRunRestVersionedParamsSchema)
  .withRawBody("text", { mediaType: "application/json" })
  .withPermission("workflows:manage")
  .responds({ 200: workflowRunAnswerSchema, 400: workflowRunRestRefusalSchema })
  .withDocs({
    summary: "Run a specific workflow version",
    description:
      "Run one pinned version of an Optimization Studio workflow synchronously and return its " +
      "output. Use this when a caller must keep hitting the same version as the workflow is " +
      "edited. The body is the workflow's own input fields, named as its entry node names them.",
    tags: ["Workflows"],
    requestBody: { schema: workflowRunRestBodySchema },
  })
  .withMiddleware(workflowRunContentType)
  .handle(({ app, input, scope, raw }, contentType) =>
    runWorkflow({
      app,
      projectId: scope.id,
      workflowId: input.workflowId,
      versionId: input.versionId,
      contentType,
      raw,
    }),
  )
  .build();
