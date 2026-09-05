/**
 * The `/api/annotations` REST family. Three shapes of resource, six operations: the project's
 * comments, one comment by id, and the comments on one trace.
 */
import {
  ANNOTATION_ANCHOR_SCOPES,
  type AnnotationAnchorScope,
  annotationSchema as annotationRowSchema,
  AnnotationNotFoundError,
  annotationAnchorScopeSchema,
} from "@langwatch/annotation-contract";
import { handlerManagedAuth } from "@langwatch/api";
import {
  baseResponses,
  type AppRestSecurity,
  type EndpointVariables,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  resolver,
  type RestErrorHandler,
  type ServiceContext,
} from "@langwatch/api/rest";
import { RequestValidationError } from "@langwatch/api/rest";
import { ValidationError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { nanoid } from "nanoid";
import { z } from "zod";

import { AnnotationApp } from "#app/annotation.app";

const logger = createLogger("langwatch:annotations");
const AUTH_REASON =
  "project API key resolved by the process's credential port and checked against the API-key ceiling";

/** The three grains this family authorizes at. */
export type AnnotationRestPermission =
  | "annotations:view"
  | "annotations:create"
  | "annotations:manage";

/**
 * What a resolved project credential gives a handler, and what a refused one answers with.
 * `body` is the response body verbatim — a bare sentence for an unauthenticated call, and the
 * full handled payload (code, meta, tips, docsUrl, fault, retryable) for a ceiling denial.
 */
export type AnnotationRestCredential =
  | Readonly<{
      ok: true;
      project: Readonly<{ id: string }>;
      /**
       * Stamps the key's last-used clock. Fire-and-forget, and called only
       * after a successful answer: a refused request must not move it.
       */
      markUsed: () => void;
    }>
  | Readonly<{ ok: false; status: ContentfulStatusCode; body: object }>;

/**
 * How this process turns a request into a project credential at one grain. A port because
 * resolving it reads API keys and role bindings out of the deployment's database, which a
 * feature package has none of.
 */
export type AnnotationRestCredentialPort = (input: {
  request: Request;
  permission: AnnotationRestPermission;
}) => Promise<AnnotationRestCredential>;

const annotationRestWriteSchema = z.object({
  comment: z.string().min(1),
  isThumbsUp: z.boolean(),
  email: z.string().nullable().optional(),
});

/** One comment, as this family answers with it. */
const annotationSchema = z.object({
  id: z.string().describe("The ID of the annotation"),
  projectId: z.string().describe("The ID of the project"),
  traceId: z.string().describe("The ID of the trace"),
  comment: z.string().nullable().describe("The comment of the annotation"),
  isThumbsUp: z.boolean().nullable().describe("The thumbs up status of the annotation"),
  userId: z.string().nullable().describe("The ID of the user"),
  email: z.string().nullable().describe("The email of the user"),
  createdAt: z.string().describe("The created at of the annotation"),
  updatedAt: z.string().describe("The updated at of the annotation"),
});

const annotationListResponse = z.object({ data: z.array(annotationSchema) });
const annotationResponse = z.object({ data: annotationSchema });
const annotationStatusResponse = z.object({
  status: z.string(),
  message: z.string(),
});

/** One JSON response body, spelled the way an operation object carries it. */
const jsonBody = (description: string, schema: z.ZodType) => ({
  description,
  content: { "application/json": { schema: resolver(schema) } },
});

/**
 * What this family validates its answers against.
 *
 * The DOCUMENTED annotation above is the narrower shape the reference has
 * always published; this is the row the store actually returns, left open so
 * that a projection carrying more than the contract names is passed through
 * rather than silently trimmed on the way out.
 */
const annotationOutputSchema = z.looseObject(annotationRowSchema.shape);
const annotationListOutput = z.object({ data: z.array(annotationOutputSchema) });
const annotationOutput = z.object({ data: annotationOutputSchema });

/** Which comments a list endpoint returns, as a query parameter. */
const anchorQuerySchema = z.object({
  anchor: annotationAnchorScopeSchema
    .optional()
    .describe(
      'Which comments to return. Omitted returns every comment, including the ones left on a span, a field, an attribute or a message; "trace" returns only the comments about whole traces.',
    ),
});

const annotationParamsSchema = z.object({ id: z.string().min(1) });

/**
 * A refusal this family answers in its own words: the credential port's own
 * body, the not-found sentence, the two field sentences, and the one generic
 * failure a store error becomes.
 */
class AnnotationRefusal extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly body: object,
  ) {
    super("annotation request refused");
    this.name = "AnnotationRefusal";
  }
}

/** What the credential middleware puts on the context for the handler. */
const ANNOTATION_CALLER = "annotationCaller";

type AnnotationCaller = Readonly<{ project: Readonly<{ id: string }>; markUsed: () => void }>;

/** The caller the middleware resolved, read off the handler's own context. */
function callerOf(c: {
  get(key: typeof ANNOTATION_CALLER): AnnotationCaller | undefined;
}): AnnotationCaller {
  const caller = c.get(ANNOTATION_CALLER);
  if (!caller) {
    throw new Error("No credential on the request context: this family's middleware did not run");
  }
  return caller;
}

/** The one body a store failure becomes, whichever route hit it. */
const INTERNAL_ERROR = { status: "error", message: "Internal server error." } as const;

// One policy per GRAIN, not one per file. A single shared policy would report
// the same requirement for a read and a delete, which is worse than reporting
// nothing: an audit reading the registry would believe it had the answer.
const annotationsViewAuth = handlerManagedAuth({
  reason: AUTH_REASON,
  permissions: ["annotations:view"],
  credential: "apiKey",
});
const annotationsCreateAuth = handlerManagedAuth({
  reason: AUTH_REASON,
  permissions: ["annotations:create"],
  credential: "apiKey",
});
const annotationsManageAuth = handlerManagedAuth({
  reason: AUTH_REASON,
  permissions: ["annotations:manage"],
  credential: "apiKey",
});

/**
 * Which comments a list endpoint returns.
 *
 * The query is read here rather than declared as a validated input because the
 * sentence a bad value answers with is this family's own, and it names the
 * whole vocabulary — which is the fact a caller acts on.
 */
function anchorScopeFromQuery(c: { req: { query(name: string): string | undefined } }) {
  const requested = c.req.query("anchor");
  if (requested === void 0) return "all" as AnnotationAnchorScope;

  const parsed = annotationAnchorScopeSchema.safeParse(requested);
  if (!parsed.success) {
    throw new ValidationError(`[anchor] must be one of: ${ANNOTATION_ANCHOR_SCOPES.join(", ")}.`);
  }
  return parsed.data;
}

export function createAnnotationsRestApp(options: {
  security: AppRestSecurity;
  /**
   * The feature's application, as a provider: mounting the family must not
   * force its services to be constructed, which is what lets the OpenAPI
   * generator and the route-registry audits build it without a live process.
   */
  annotations: () => AnnotationApp;
  credential: AnnotationRestCredentialPort;
}): MountableRestApp {
  const { security, annotations, credential } = options;

  // `/api` with no version namespace: this family owns three literal paths
  // under a prefix twenty others share, and a version guard here would claim
  // every one of their URLs.
  const { service, policy } = security.createServiceVersionedApp({
    name: "annotations",
    basePath: "/api",
    bareMount: true,
    errorEnvelope: "legacy",
    errorHandler:
      (boundary): RestErrorHandler =>
      (error, c) => {
        if (error instanceof AnnotationRefusal) return c.json(error.body, error.status);
        // A body the write schema rejected, in the three sentences this door
        // has always answered: the first offending field it names, then the
        // catch-all. The framework's own 422 envelope would be a fourth shape
        // for a caller that already branches on these.
        if (error instanceof RequestValidationError) {
          const fields = (error.meta.fields as string[] | undefined) ?? [];
          const offends = (name: string) =>
            fields.some((field) => field === name || field.startsWith(`${name}.`));
          if (offends("comment")) {
            return c.json(
              {
                status: "error",
                message: "[comment] is required in the request body and must be a string.",
              },
              400,
            );
          }
          if (offends("isThumbsUp")) {
            return c.json(
              {
                status: "error",
                message: "[isThumbsUp] is required in the request body and must be a boolean.",
              },
              400,
            );
          }
          return c.json({ status: "error", message: "Invalid request body." }, 400);
        }
        return boundary(error, c);
      },
  });

  /**
   * The project credential, resolved before anything reads the request — the
   * order this family has always answered in.
   */
  const authenticate = (permission: AnnotationRestPermission): MiddlewareHandler => {
    return async (c, next) => {
      const auth = await credential({ request: c.req.raw, permission });
      if (!auth.ok) throw new AnnotationRefusal(auth.status, auth.body);
      c.set(ANNOTATION_CALLER, { project: auth.project, markUsed: auth.markUsed });
      await next();
    };
  };

  /** A store failure: logged with its context, answered generically (ADR-045). */
  const storeFailure = (error: unknown, context: Record<string, unknown>, sentence: string) => {
    logger.error({ error, ...context }, sentence);
    return new AnnotationRefusal(500, INTERNAL_ERROR);
  };

  type AnnotationContext = ServiceContext<EndpointVariables>;

  const listHandler = async (c: AnnotationContext) => {
    const { project, markUsed } = callerOf(c);
    const anchor = anchorScopeFromQuery(c);
    try {
      const rows = await annotations().list({ projectId: project.id, anchor });
      markUsed();
      return { data: rows };
    } catch (e) {
      throw storeFailure(e, { projectId: project.id }, "error fetching annotations");
    }
  };

  const getHandler = async (
    c: AnnotationContext,
    input: z.infer<typeof annotationParamsSchema>,
  ) => {
    const { project, markUsed } = callerOf(c);
    try {
      let annotation;
      try {
        annotation = await annotations().getById({ id: input.id, projectId: project.id });
      } catch (error) {
        if (error instanceof AnnotationNotFoundError) {
          throw new AnnotationRefusal(404, {
            status: "error",
            message: "Annotation not found.",
          });
        }
        throw error;
      }
      markUsed();
      return { data: annotation };
    } catch (e) {
      if (e instanceof AnnotationRefusal) throw e;
      throw storeFailure(e, { projectId: project.id }, "error fetching annotation");
    }
  };

  const deleteHandler = async (
    c: AnnotationContext,
    input: z.infer<typeof annotationParamsSchema>,
  ) => {
    const { project, markUsed } = callerOf(c);
    try {
      await annotations().delete({ id: input.id, projectId: project.id });
      markUsed();
      return { status: "success", message: "Annotation deleted." };
    } catch (e) {
      throw storeFailure(e, { projectId: project.id }, "error deleting annotation");
    }
  };

  const patchHandler = async (
    c: AnnotationContext,
    input: z.infer<typeof annotationParamsSchema> & z.infer<typeof annotationRestWriteSchema>,
  ) => {
    const { project, markUsed } = callerOf(c);
    try {
      const patched = await annotations().update({
        id: input.id,
        projectId: project.id,
        comment: input.comment,
        isThumbsUp: input.isThumbsUp,
        ...(input.email === void 0 ? {} : { email: input.email }),
      });
      markUsed();
      return { data: patched };
    } catch (e) {
      throw storeFailure(e, { projectId: project.id }, "error patching annotation");
    }
  };

  const listByTraceHandler = async (
    c: AnnotationContext,
    input: z.infer<typeof annotationParamsSchema>,
  ) => {
    const { project, markUsed } = callerOf(c);
    const anchor = anchorScopeFromQuery(c);
    try {
      const rows = await annotations().list({
        projectId: project.id,
        traceIds: [input.id],
        anchor,
      });
      markUsed();
      return { data: rows };
    } catch (e) {
      throw storeFailure(
        e,
        { trace: input.id, projectId: project.id },
        "error fetching annotations for trace",
      );
    }
  };

  const createForTraceHandler = async (
    c: AnnotationContext,
    input: z.infer<typeof annotationParamsSchema> & z.infer<typeof annotationRestWriteSchema>,
  ) => {
    const { project, markUsed } = callerOf(c);
    try {
      // Unattributed on purpose: this family authenticates with a project key,
      // so there is no reviewer to credit. `email` is the only identity an
      // external annotator gives us.
      const created = await annotations().createUnattributed({
        id: nanoid(),
        comment: input.comment,
        projectId: project.id,
        isThumbsUp: input.isThumbsUp,
        traceId: input.id,
        ...(input.email === void 0 ? {} : { email: input.email }),
        scoreOptions: {},
        expectedOutput: null,
      });
      markUsed();
      return { data: created };
    } catch (e) {
      throw storeFailure(
        e,
        { trace: input.id, projectId: project.id },
        "error creating annotation",
      );
    }
  };

  return (
    service
      .registerRoute("get", "/annotations", MANAGEMENT_API_VERSION, listHandler, (b) =>
        policy(annotationsViewAuth)(b)
          .withMiddleware(authenticate("annotations:view"))
          .withQuery(anchorQuerySchema)
          .withOutput(annotationListOutput)
          .withDocs({
            operationId: "listAnnotations",
            description: "Returns all annotations for project",
            responses: {
              ...baseResponses,
              200: jsonBody("Annotation response", annotationListResponse),
            },
          }),
      )
      .registerRoute("get", "/annotations/:id", MANAGEMENT_API_VERSION, getHandler, (b) =>
        policy(annotationsViewAuth)(b)
          .withMiddleware(authenticate("annotations:view"))
          .withParams(annotationParamsSchema)
          .withOutput(annotationOutput)
          .withDocs({
            operationId: "getAnnotation",
            description: "Returns a single annotation based on the ID supplied",
            responses: {
              ...baseResponses,
              200: jsonBody("Annotation response", annotationResponse),
            },
          }),
      )
      .registerRoute("delete", "/annotations/:id", MANAGEMENT_API_VERSION, deleteHandler, (b) =>
        policy(annotationsManageAuth)(b)
          .withMiddleware(authenticate("annotations:manage"))
          .withParams(annotationParamsSchema)
          .withOutput(annotationStatusResponse)
          .withDocs({
            operationId: "deleteAnnotation",
            description: "Deletes a single annotation based on the ID supplied",
            responses: {
              ...baseResponses,
              200: jsonBody("Annotation deleted", annotationStatusResponse),
            },
          }),
      )
      .registerRoute("patch", "/annotations/:id", MANAGEMENT_API_VERSION, patchHandler, (b) =>
        policy(annotationsManageAuth)(b)
          .withMiddleware(authenticate("annotations:manage"))
          .withParams(annotationParamsSchema)
          .withInput(annotationRestWriteSchema)
          .withOutput(annotationOutput)
          .withDocs({
            operationId: "updateAnnotation",
            description: "Updates a single annotation based on the ID supplied",
            responses: {
              ...baseResponses,
              200: jsonBody("Annotation response", annotationResponse),
            },
          }),
      )
      .registerRoute(
        "get",
        "/annotations/trace/:id",
        MANAGEMENT_API_VERSION,
        listByTraceHandler,
        (b) =>
          policy(annotationsViewAuth)(b)
            .withMiddleware(authenticate("annotations:view"))
            .withParams(annotationParamsSchema)
            .withQuery(anchorQuerySchema)
            .withOutput(annotationListOutput)
            .withDocs({
              operationId: "listTraceAnnotations",
              description: "Returns all annotations for single trace",
              responses: {
                ...baseResponses,
                200: jsonBody("Annotation response", annotationListResponse),
              },
            }),
      )
      // `:create` (not `:manage`) — same fix as evaluators' POST route. A create
      // asks for the create grain; demanding `:manage` here would refuse every
      // restricted key that can create but not delete, which is exactly how
      // `scenarios:create` produced a production 403. (`:manage` still implies
      // `:create` via the hierarchy, so nobody loses access.)
      .registerRoute(
        "post",
        "/annotations/trace/:id",
        MANAGEMENT_API_VERSION,
        createForTraceHandler,
        (b) =>
          policy(annotationsCreateAuth)(b)
            .withMiddleware(authenticate("annotations:create"))
            .withParams(annotationParamsSchema)
            .withInput(annotationRestWriteSchema)
            .withOutput(annotationOutput)
            .withDocs({
              operationId: "createTraceAnnotation",
              description: "Create an annotation for a single trace",
              responses: {
                ...baseResponses,
                200: jsonBody("Annotation created", annotationResponse),
              },
            }),
      )
      .build()
  );
}
