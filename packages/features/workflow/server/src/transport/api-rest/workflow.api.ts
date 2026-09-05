import type { AuthzPermission } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import {
  WorkflowNotFoundError,
  type Workflow,
  type WorkflowService,
} from "@langwatch/workflow-contract";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { z } from "zod";
import { requires } from "@langwatch/api";
import {
  type AppRestSecurity,
  badRequestSchema,
  baseResponses,
  type EndpointVariables,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  type PlatformUrlBuilder,
  projectOf,
  type ProjectScopedContext,
  resolver,
} from "@langwatch/api/rest";

const logger = createLogger("langwatch:api:workflows");

const workflowResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  description: z.string().nullable(),
  isEvaluator: z.boolean(),
  isComponent: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const workflowResponseWithPlatformUrlSchema = workflowResponseSchema.extend({
  platformUrl: z.string().url(),
});

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

const evaluateBodySchema = z
  .object({
    version_id: z
      .string()
      .optional()
      .describe("Committed version to evaluate; defaults to the latest commit"),
    data: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe("Inline rows to evaluate instead of the workflow's attached dataset"),
    dataset_id: z
      .string()
      .optional()
      .describe("Platform dataset id to evaluate; mutually exclusive with data"),
    parameters: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional()
      .describe("Constant entry inputs applied to every row, e.g. a feature flag or PR number"),
    row_indices: z
      .array(z.number().int().nonnegative())
      .optional()
      .describe("Subset of dataset row indices to evaluate"),
  })
  .refine((b) => !(b.data && b.dataset_id), {
    message: "Pass either data or a dataset_id, not both",
    path: ["data"],
  });

/**
 * What an evaluation trigger answers with.
 *
 * A refusal is a value rather than an exception on purpose: the three ways a
 * trigger can be refused — no such workflow, nothing committed to evaluate, a
 * dataset reference that does not resolve — are named by the application's own
 * evaluation taxonomy, which this package cannot see. Naming the STATUS and the
 * customer-safe sentence here keeps the mapping visible in the route rather
 * than in a catch that recognises classes by identity.
 */
export type WorkflowEvaluationOutcome =
  | Readonly<{
      ok: true;
      runId: string;
      runUrl: string;
      workflowVersionId: string;
      version: string;
    }>
  | Readonly<{ ok: false; status: 400 | 404; error: string }>;

/** Starting one evaluation run of a workflow's committed version. */
export type WorkflowEvaluationTrigger = (
  input: Readonly<{
    projectId: string;
    projectSlug: string;
    workflowId: string;
    versionId?: string;
    data?: Record<string, unknown>[];
    datasetId?: string;
    parameters?: Record<string, string | number | boolean>;
    rowIndices?: number[];
  }>,
) => Promise<WorkflowEvaluationOutcome>;

/**
 * The process capabilities the workflow REST family needs beyond its service.
 *
 * All three are the application's: where its UI is served from, its API-key
 * ceiling, and the evaluations pipeline a workflow run is started through.
 */
export interface WorkflowRestPorts {
  /** A deep link into the application's UI for a project-scoped resource. */
  platformUrl: PlatformUrlBuilder;
  /**
   * The API-key ceiling for one permission: a legacy project key keeps full
   * access, a scoped API key must hold the permission. Runs after the family's
   * own access policy, which is what resolves the credential it reads.
   */
  requireApiKeyPermission: (permission: AuthzPermission) => MiddlewareHandler;
  /** Starts an evaluation run through the evaluations pipeline. */
  triggerEvaluation: WorkflowEvaluationTrigger;
}

/**
 * A trigger the application refused, carrying the status and the sentence it
 * named. The three refusals are the application's own taxonomy, which this
 * package cannot see, so the value it answers becomes this error and the
 * family's handler writes the body it has always written.
 */
class WorkflowEvaluationRefusedError extends Error {
  constructor(
    readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The family's refusals, in the bare `{ error }` body they have always had.
 */
const workflowErrorHandler =
  (boundary: ErrorHandler): ErrorHandler =>
  (error, c) => {
    if (error instanceof WorkflowEvaluationRefusedError) {
      return c.json({ error: error.message }, error.status);
    }
    if (error instanceof WorkflowNotFoundError) {
      return c.json({ error: "Workflow not found" }, 404);
    }
    return boundary(error, c);
  };

const idParamsSchema = z.object({ id: z.string().min(1) });

const updateWorkflowSchema = z.object({
  name: z.string().min(1).optional(),
  icon: z.string().optional(),
  description: z.string().optional(),
});

const archivedWorkflowSchema = z.object({ id: z.string(), archived: z.boolean() });

const evaluationStartedSchema = z.object({
  run_id: z.string(),
  run_url: z.string(),
  workflow_version_id: z.string(),
  version: z.string(),
});

/**
 * The `/api/workflows` CRUD family, built against one process's security.
 *
 * `workflows` is resolved per request, as reading it off the Hono context used
 * to be: mounting a family must not force its services to be constructed,
 * which is what lets the OpenAPI generator and the route-registry audits build
 * it with none.
 *
 * The Studio's own transports — `/api/workflows/code-completion` and
 * `/api/workflows/post_event` — are a separate family in the application: they
 * are session-authenticated SSE surfaces rather than API-key CRUD, and they
 * are mounted ahead of this one so their specific paths win over `/:id`.
 */
export function createWorkflowsRestApp(options: {
  security: AppRestSecurity;
  workflows: () => WorkflowService;
  ports: WorkflowRestPorts;
}): MountableRestApp {
  const { security, workflows, ports } = options;

  const { service, policy } = security.createProjectVersionedApp({
    name: "workflows",
    basePath: "/api/workflows",
    errorEnvelope: "legacy",
    errorHandler: workflowErrorHandler,
  });

  type WorkflowContext = ProjectScopedContext<EndpointVariables>;

  const studioUrl = (projectSlug: string, workflowId: string) =>
    ports.platformUrl({ projectSlug, path: `/studio/${workflowId}` });

  const listHandler = async (c: WorkflowContext) => {
    const project = projectOf(c);
    logger.info({ projectId: project.id }, "Listing workflows");

    const listed = await workflows().list({ projectId: project.id });
    return listed.map((w) => ({
      ...toWorkflowResponse(w),
      platformUrl: studioUrl(project.slug, w.id),
    }));
  };

  const getHandler = async (c: WorkflowContext, input: z.infer<typeof idParamsSchema>) => {
    const project = projectOf(c);
    logger.info({ projectId: project.id, workflowId: input.id }, "Getting workflow");

    const workflow = await workflows().getById({ id: input.id, projectId: project.id });
    return {
      ...toWorkflowResponse(workflow),
      platformUrl: studioUrl(project.slug, workflow.id),
    };
  };

  const updateHandler = async (
    c: WorkflowContext,
    input: z.infer<typeof idParamsSchema> & z.infer<typeof updateWorkflowSchema>,
  ) => {
    const project = projectOf(c);
    const { id, ...body } = input;
    logger.info({ projectId: project.id, workflowId: id }, "Updating workflow");

    const service_ = workflows();
    await service_.assertInProject({ workflowId: id, projectId: project.id });
    const updated = await service_.update({ id, projectId: project.id, ...body });

    return {
      ...toWorkflowResponse(updated),
      platformUrl: studioUrl(project.slug, updated.id),
    };
  };

  const archiveHandler = async (c: WorkflowContext, input: z.infer<typeof idParamsSchema>) => {
    const project = projectOf(c);
    logger.info({ projectId: project.id, workflowId: input.id }, "Archiving workflow");

    await workflows().archive({ id: input.id, projectId: project.id });
    return { id: input.id, archived: true };
  };

  const evaluateHandler = async (
    c: WorkflowContext,
    input: z.infer<typeof idParamsSchema> & z.infer<typeof evaluateBodySchema>,
  ) => {
    const project = projectOf(c);
    const { id } = input;
    logger.info(
      { projectId: project.id, workflowId: id },
      "Triggering workflow evaluation via API",
    );

    const outcome = await ports.triggerEvaluation({
      projectId: project.id,
      projectSlug: project.slug,
      workflowId: id,
      versionId: input.version_id,
      data: input.data,
      datasetId: input.dataset_id,
      parameters: input.parameters,
      rowIndices: input.row_indices,
    });

    if (!outcome.ok) {
      throw new WorkflowEvaluationRefusedError(outcome.status, outcome.error);
    }

    return {
      run_id: outcome.runId,
      run_url: outcome.runUrl,
      workflow_version_id: outcome.workflowVersionId,
      version: outcome.version,
    };
  };

  const notFoundResponse = {
    404: {
      description: "Workflow not found",
      content: { "application/json": { schema: resolver(badRequestSchema) } },
    },
  };

  return (
    service
      .registerRoute("get", "/", MANAGEMENT_API_VERSION, listHandler, (b) =>
        policy(requires("workflows:view"))(b)
          .withOutput(z.array(workflowResponseWithPlatformUrlSchema))
          .withDocs({
            description: "List all non-archived workflows for the project",
            responses: {
              ...baseResponses,
              200: {
                description: "Success",
                content: {
                  "application/json": {
                    schema: resolver(z.array(workflowResponseWithPlatformUrlSchema)),
                  },
                },
              },
            },
          }),
      )
      .registerRoute("get", "/:id", MANAGEMENT_API_VERSION, getHandler, (b) =>
        policy(requires("workflows:view"))(b)
          .withParams(idParamsSchema)
          .withOutput(workflowResponseWithPlatformUrlSchema)
          .withDocs({
            description: "Get a workflow by its ID",
            responses: {
              ...baseResponses,
              200: {
                description: "Success",
                content: {
                  "application/json": {
                    schema: resolver(workflowResponseWithPlatformUrlSchema),
                  },
                },
              },
              ...notFoundResponse,
            },
          }),
      )
      // Editing metadata on a workflow that already exists is an `:update`.
      // `:manage` still implies it, so no existing caller changes.
      .registerRoute("patch", "/:id", MANAGEMENT_API_VERSION, updateHandler, (b) =>
        policy(requires("workflows:update"))(b)
          .withParams(idParamsSchema)
          .withInput(updateWorkflowSchema)
          .withOutput(workflowResponseWithPlatformUrlSchema)
          .withDocs({
            description: "Update a workflow's metadata (name, icon, description)",
            responses: {
              ...baseResponses,
              200: {
                description: "Workflow updated",
                content: {
                  "application/json": {
                    schema: resolver(workflowResponseWithPlatformUrlSchema),
                  },
                },
              },
              ...notFoundResponse,
            },
          }),
      )
      // Archiving deliberately stays at `:manage`.
      .registerRoute("delete", "/:id", MANAGEMENT_API_VERSION, archiveHandler, (b) =>
        policy(requires("workflows:manage"))(b)
          .withParams(idParamsSchema)
          .withOutput(archivedWorkflowSchema)
          .withDocs({
            description: "Archive (soft-delete) a workflow",
            responses: {
              ...baseResponses,
              200: {
                description: "Workflow archived",
                content: {
                  "application/json": { schema: resolver(archivedWorkflowSchema) },
                },
              },
              ...notFoundResponse,
            },
          }),
      )
      // Running a workflow is not administering it: the committed version, its
      // nodes and its dataset are untouched — the call produces a RUN. So it
      // asks for `workflows:create`, the same grain as the suite run. The
      // second gate below is unchanged: the caller must also be able to READ
      // the run.
      .registerRoute("post", "/:id/evaluate", MANAGEMENT_API_VERSION, evaluateHandler, (b) =>
        policy(requires("workflows:create"))(b)
          .withParams(idParamsSchema)
          .withInput(evaluateBodySchema)
          .withOutput(evaluationStartedSchema)
          // The caller polls the run + reads results on
          // /api/experiments/runs/:runId(/results), which require
          // evaluations:view. Enforced here too so a workflows-only key cannot
          // start a run it would then get 403 trying to read.
          .withMiddleware(ports.requireApiKeyPermission("evaluations:view"))
          .withDocs({
            description:
              "Trigger an evaluation run of a workflow's committed version through " +
              "the evaluations pipeline. Evaluate the workflow's attached dataset, " +
              "inline data, or a platform dataset id; parameters bind as constant " +
              "entry inputs on every row. Returns a run id and a results URL to poll " +
              "or open in the browser.",
            responses: {
              ...baseResponses,
              200: {
                description: "Evaluation started",
                content: {
                  "application/json": { schema: resolver(evaluationStartedSchema) },
                },
              },
              400: {
                description: "No committed version to evaluate",
                content: { "application/json": { schema: resolver(badRequestSchema) } },
              },
              ...notFoundResponse,
            },
          }),
      )
      .build()
  );
}
