import type { AuthzPermission } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import {
  WorkflowNotFoundError,
  type Workflow,
  type WorkflowService,
} from "@langwatch/workflow-contract";
import type { MiddlewareHandler } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import {
  type AppRestProjectVariables,
  type AppRestSecurity,
  badRequestSchema,
  baseResponses,
  patchZodOpenapi,
  type PlatformUrlBuilder,
  requires,
  type SecuredApp,
  validator as zValidator,
} from "../../app-rest";

patchZodOpenapi();

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
}): SecuredApp<{ Variables: AppRestProjectVariables }> {
  const { security, workflows, ports } = options;

  const secured = security.createProjectApp({ basePath: "/api/workflows" });

  secured.access(requires("workflows:view")).get(
    "/",
    describeRoute({
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
    async (c) => {
      const project = c.get("project");
      logger.info({ projectId: project.id }, "Listing workflows");

      const listed = await workflows().list({ projectId: project.id });

      return c.json(
        listed.map((w) => ({
          ...toWorkflowResponse(w),
          platformUrl: ports.platformUrl({
            projectSlug: project.slug,
            path: `/studio/${w.id}`,
          }),
        })),
      );
    },
  );

  secured.access(requires("workflows:view")).get(
    "/:id",
    describeRoute({
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
        404: {
          description: "Workflow not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      logger.info({ projectId: project.id, workflowId: id }, "Getting workflow");

      let workflow;
      try {
        workflow = await workflows().getById({
          id,
          projectId: project.id,
        });
      } catch (error) {
        if (!(error instanceof WorkflowNotFoundError)) throw error;
        return c.json({ error: "Workflow not found" }, 404);
      }

      return c.json({
        ...toWorkflowResponse(workflow),
        platformUrl: ports.platformUrl({
          projectSlug: project.slug,
          path: `/studio/${workflow.id}`,
        }),
      });
    },
  );

  // Editing metadata on a workflow that already exists is an `:update`.
  // `:manage` still implies it, so no existing caller changes.
  secured.access(requires("workflows:update")).patch(
    "/:id",
    describeRoute({
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
        404: {
          description: "Workflow not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    zValidator(
      "json",
      z.object({
        name: z.string().min(1).optional(),
        icon: z.string().optional(),
        description: z.string().optional(),
      }),
    ),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      const body = c.req.valid("json");
      logger.info({ projectId: project.id, workflowId: id }, "Updating workflow");

      const service = workflows();
      try {
        await service.assertInProject({ workflowId: id, projectId: project.id });
      } catch (error) {
        if (!(error instanceof WorkflowNotFoundError)) throw error;
        return c.json({ error: "Workflow not found" }, 404);
      }
      const updated = await service.update({
        id,
        projectId: project.id,
        ...body,
      });

      return c.json({
        ...toWorkflowResponse(updated),
        platformUrl: ports.platformUrl({
          projectSlug: project.slug,
          path: `/studio/${updated.id}`,
        }),
      });
    },
  );

  // Archiving deliberately stays at `:manage`.
  secured.access(requires("workflows:manage")).delete(
    "/:id",
    describeRoute({
      description: "Archive (soft-delete) a workflow",
      responses: {
        ...baseResponses,
        200: {
          description: "Workflow archived",
          content: {
            "application/json": {
              schema: resolver(z.object({ id: z.string(), archived: z.boolean() })),
            },
          },
        },
        404: {
          description: "Workflow not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      logger.info({ projectId: project.id, workflowId: id }, "Archiving workflow");

      try {
        await workflows().archive({
          id,
          projectId: project.id,
        });
      } catch (error) {
        if (!(error instanceof WorkflowNotFoundError)) throw error;
        return c.json({ error: "Workflow not found" }, 404);
      }

      return c.json({ id, archived: true });
    },
  );

  // Running a workflow is not administering it: the committed version, its nodes
  // and its dataset are untouched — the call produces a RUN. So it asks for
  // `workflows:create`, the same grain as the suite run. `:manage` still implies
  // it, so nobody who could trigger an evaluation yesterday loses that, and a
  // viewer holding only `workflows:view` is declined exactly as before. The
  // second gate below is unchanged: the caller must also be able to READ the run.
  secured.access(requires("workflows:create")).post(
    "/:id/evaluate",
    describeRoute({
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
            "application/json": {
              schema: resolver(
                z.object({
                  run_id: z.string(),
                  run_url: z.string(),
                  workflow_version_id: z.string(),
                  version: z.string(),
                }),
              ),
            },
          },
        },
        400: {
          description: "No committed version to evaluate",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
        404: {
          description: "Workflow not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    // The caller polls the run + reads results on /api/experiments/runs/:runId(/results),
    // which require evaluations:view. Enforce it here too so a workflows-only key
    // cannot start a run it would then get 403 trying to read.
    ports.requireApiKeyPermission("evaluations:view"),
    zValidator("json", evaluateBodySchema),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      const body = c.req.valid("json");
      logger.info(
        { projectId: project.id, workflowId: id },
        "Triggering workflow evaluation via API",
      );

      const outcome = await ports.triggerEvaluation({
        projectId: project.id,
        projectSlug: project.slug,
        workflowId: id,
        versionId: body.version_id,
        data: body.data,
        datasetId: body.dataset_id,
        parameters: body.parameters,
        rowIndices: body.row_indices,
      });

      if (!outcome.ok) {
        return c.json({ error: outcome.error }, outcome.status);
      }

      return c.json({
        run_id: outcome.runId,
        run_url: outcome.runUrl,
        workflow_version_id: outcome.workflowVersionId,
        version: outcome.version,
      });
    },
  );

  return secured;
}
