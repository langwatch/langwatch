/**
 * The three URLs a synchronous Optimization Studio run is started from:
 * `POST /api/workflows/{workflowId}/run`,
 * `POST /api/workflows/{workflowId}/{versionId}/run`, and the older
 * `POST /api/optimization/{workflowId}/{versionId}`.
 *
 * ONE handler serves all three, and that is the point of the file. The legacy
 * path used to carry its own copy of the run, with its own
 * catch-and-flatten-to-500, and the two had already drifted to disagree about
 * the status code for identical failures. Delegating removes the only way they
 * can drift again.
 *
 * The family resolves its own project key rather than going through the
 * framework chain, because the refusals it publishes are the ones an SDK
 * already parses: `{ message }` at 400 and 401, and the handled envelope at
 * 403 and 404. Those two 404s are the interesting ones — a workflow that does
 * not exist, a workflow that was never published, and a pinned version that
 * was never committed are three different things a caller acts on differently,
 * so each keeps its own code rather than collapsing into one "not found".
 */
import { handlerManagedAuth } from "@langwatch/api";
import {
  type AppRestSecurity,
  type EndpointVariables,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  resolver,
  type RestErrorHandler,
  type ServiceContext,
} from "@langwatch/api/rest";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { NotFoundError, ValidationError } from "@langwatch/handled-error";
import {
  WorkflowNotFoundError,
  WorkflowNotPublishedError,
  WorkflowVersionNotFoundError,
  type WorkflowService,
} from "@langwatch/workflow-contract";
import type { MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

/**
 * A refusal this door answers in its own words rather than through the
 * envelope: an SDK parses `{ message }` at 400 and 401.
 */
class WorkflowRunRefusal extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly body: object,
  ) {
    super("workflow run refused");
    this.name = "WorkflowRunRefusal";
  }
}

/** What the credential middleware puts on the context for the handler. */
const RUN_CALLER = "workflowRunCaller";

type WorkflowRunCaller = Readonly<{
  project: Readonly<{ id: string }>;
  markUsed: () => void;
}>;

/** The caller the middleware resolved, read off the handler's own context. */
function callerOf(c: {
  get(key: typeof RUN_CALLER): WorkflowRunCaller | undefined;
}): WorkflowRunCaller {
  const caller = c.get(RUN_CALLER);
  if (!caller) {
    throw new Error("No credential on the request context: the run door's middleware did not run");
  }
  return caller;
}

/** A resolved project credential, or the refusal to answer in its place. */
export type WorkflowRunRestCredential =
  | Readonly<{ ok: true; project: Readonly<{ id: string }>; markUsed: () => void }>
  | Readonly<{ ok: false; status: ContentfulStatusCode; body: object }>;

/** What the three run URLs reach that they do not own. */
export interface WorkflowRunRestPorts {
  /** Resolves the request's project key and enforces `workflows:manage` on it. */
  authenticateCredential(input: {
    request: Request;
    permission: AuthzPermission;
  }): Promise<WorkflowRunRestCredential>;
  /** The studio graph service the run executes on. */
  workflows(): Pick<WorkflowService, "run">;
}

/**
 * What a synchronous workflow run answers with.
 *
 * `result` is the workflow's own output, keyed by its output field names, so
 * it is different for every workflow and cannot be narrowed here. `status` is
 * the execution state the engine finished in.
 */
const workflowRunResponseSchema = z.object({
  status: z
    .enum(["idle", "waiting", "running", "success", "error", "skipped"])
    .describe("Execution state the run finished in"),
  result: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional()
    .describe("The workflow's output fields, named as the workflow names them"),
});

/**
 * The body the REST boundary sends for a thrown `HandledError`.
 *
 * Restated rather than imported: the canonical declaration is in another
 * feature's server package, and a feature server may not reach into one. It is
 * a documentation shape with no runtime role here, so a structural restatement
 * costs nothing a shared import would have bought.
 */
const handledErrorEnvelopeSchema = z
  .object({
    error: z.string().describe("Stable failure code; branch on this"),
    message: z.string().optional(),
    fault: z
      .string()
      .optional()
      .describe("Who the failure is attributable to: customer, platform, provider"),
    tips: z.array(z.string()).optional(),
    docsUrl: z.string().optional(),
  })
  .passthrough();

/**
 * What the run route validates its answer against.
 *
 * Open where the documented shape is closed: the engine's answer carries the
 * two fields below and whatever else that execution recorded, and a closed
 * schema would silently drop the rest on the way out. The document keeps the
 * named shape, which is what a caller reads.
 */
const workflowRunOutputSchema = z.looseObject({
  status: z.enum(["idle", "waiting", "running", "success", "error", "skipped"]),
  result: z.record(z.string(), z.unknown()).nullable().optional(),
});

const workflowRunResponses = {
  200: {
    description: "The workflow finished; `result` holds its output fields",
    content: {
      "application/json": { schema: resolver(workflowRunResponseSchema) },
    },
  },
  400: {
    description: "The request was not sent as application/json, or the body was not valid JSON",
    content: {
      "application/json": {
        schema: resolver(z.object({ message: z.string() })),
      },
    },
  },
  401: {
    description: "Missing or invalid API key",
    content: {
      "application/json": {
        schema: resolver(z.object({ message: z.string() })),
      },
    },
  },
  403: {
    description: "The API key lacks workflows:manage",
    content: {
      "application/json": { schema: resolver(handledErrorEnvelopeSchema) },
    },
  },
  404: {
    description: "No such workflow, or it has never been published",
    content: {
      "application/json": { schema: resolver(handledErrorEnvelopeSchema) },
    },
  },
} as const;

/**
 * A workflow run takes the workflow's own entry fields as its body, so there is
 * no fixed set of properties to name: open the object and say where the names
 * come from.
 */
const workflowRunRequestBody = {
  required: true,
  content: {
    "application/json": {
      schema: {
        type: "object" as const,
        additionalProperties: true,
        description: "The workflow's input fields, named as the workflow's entry node names them",
      },
    },
  },
};

/** `/api/workflows/…/run` and `/api/optimization/…`, bound to one process. */
export function createWorkflowRunRestApp(options: {
  security: AppRestSecurity;
  ports: WorkflowRunRestPorts;
}): MountableRestApp {
  const { security, ports } = options;

  // `/api` with no version namespace: these three literal paths sit under a
  // prefix twenty other families share, and a version guard here would claim
  // every one of their URLs.
  const { service, policy } = security.createServiceVersionedApp({
    name: "workflow-run",
    basePath: "/api",
    bareMount: true,
    errorEnvelope: "legacy",
    errorHandler:
      (boundary): RestErrorHandler =>
      (error, c) =>
        error instanceof WorkflowRunRefusal ? c.json(error.body, error.status) : boundary(error, c),
  });

  const runAuth = handlerManagedAuth({
    reason: "project API key resolved by the process's credential port and its ceiling enforced",
    permissions: ["workflows:manage"],
    credential: "apiKey",
  });

  /** The project key, resolved before the body is looked at. */
  const authenticate: MiddlewareHandler = async (c, next) => {
    const credential = await ports.authenticateCredential({
      request: c.req.raw,
      permission: "workflows:manage",
    });
    if (!credential.ok) {
      throw new WorkflowRunRefusal(credential.status, credential.body);
    }
    c.set(RUN_CALLER, { project: credential.project, markUsed: credential.markUsed });
    await next();
  };

  const runWorkflow = async (
    c: ServiceContext<EndpointVariables>,
    input: { workflowId: string; versionId?: string; body: string },
  ) => {
    const { project, markUsed } = callerOf(c);

    const contentType = c.req.header("content-type");
    if (!contentType?.includes("application/json")) {
      throw new WorkflowRunRefusal(400, { message: "Invalid body, expecting json" });
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(input.body) as Record<string, unknown>;
    } catch {
      throw new WorkflowRunRefusal(400, { message: "Invalid body" });
    }

    // Failures propagate to the family's error boundary, which already maps a
    // `HandledError` to its own status. Catching here and hard-coding 500 was
    // what masked all three of the named refusals below as raw 500s.
    let result: unknown;
    try {
      result = await ports.workflows().run({
        workflowId: input.workflowId,
        projectId: project.id,
        inputs: body,
        ...(input.versionId ? { versionId: input.versionId } : {}),
      });
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) {
        throw new NotFoundError("workflow_not_found", "Workflow", input.workflowId);
      }
      if (error instanceof WorkflowNotPublishedError) {
        throw new ValidationError("Workflow not published", {
          meta: { workflowId: input.workflowId },
        });
      }
      if (error instanceof WorkflowVersionNotFoundError) {
        throw new NotFoundError(
          "published_workflow_version_not_found",
          "Published workflow version",
          error.versionId,
        );
      }
      throw error;
    }
    markUsed();
    return result;
  };

  const versionedParamsSchema = z.object({
    workflowId: z.string().min(1),
    versionId: z.string().min(1),
  });
  const workflowParamsSchema = z.object({ workflowId: z.string().min(1) });

  return service
    .registerRoute(
      "post",
      "/optimization/:workflowId/:versionId",
      MANAGEMENT_API_VERSION,
      runWorkflow,
      (b) =>
        policy(runAuth)(b)
          .withMiddleware(authenticate)
          .withParams(versionedParamsSchema)
          .withRawBody("text", { contentType: "application/json" })
          .withOutput(workflowRunOutputSchema)
          .withDocs({
            operationId: "runOptimizationWorkflowVersion",
            summary: "Run a workflow version (legacy path)",
            description:
              "Run one pinned version of an Optimization Studio workflow synchronously. Identical to `POST /api/workflows/{workflowId}/{versionId}/run`, which is the path to use in new integrations; this one stays for callers written against it. The body is the workflow's own input fields, named as its entry node names them.",
            tags: ["Workflows"],
            responses: workflowRunResponses,
          }),
    )
    .registerRoute("post", "/workflows/:workflowId/run", MANAGEMENT_API_VERSION, runWorkflow, (b) =>
      policy(runAuth)(b)
        .withMiddleware(authenticate)
        .withParams(workflowParamsSchema)
        .withRawBody("text", { contentType: "application/json" })
        .withOutput(workflowRunOutputSchema)
        .withDocs({
          operationId: "runWorkflow",
          summary: "Run a workflow",
          description:
            "Run an Optimization Studio workflow synchronously and return its output. Runs the workflow's published version; address a specific version with the `{versionId}` form of this path. The body is the workflow's own input fields, named as its entry node names them.",
          tags: ["Workflows"],
          responses: workflowRunResponses,
        }),
    )
    .registerRoute(
      "post",
      "/workflows/:workflowId/:versionId/run",
      MANAGEMENT_API_VERSION,
      runWorkflow,
      (b) =>
        policy(runAuth)(b)
          .withMiddleware(authenticate)
          .withParams(versionedParamsSchema)
          .withRawBody("text", { contentType: "application/json" })
          .withOutput(workflowRunOutputSchema)
          .withDocs({
            operationId: "runWorkflowVersion",
            summary: "Run a specific workflow version",
            description:
              "Run one pinned version of an Optimization Studio workflow synchronously and return its output. Use this when a caller must keep hitting the same version as the workflow is edited. The body is the workflow's own input fields, named as its entry node names them.",
            tags: ["Workflows"],
            responses: workflowRunResponses,
          }),
    )
    .build();
}
