/**
 * The `/api/annotations` REST family.
 *
 * Three shapes of resource, six operations: the project's comments, one
 * comment by id, and the comments on one trace. Every route authenticates with
 * a PROJECT credential and nothing else — there is no reviewer behind a project
 * key, which is why the create is unattributed and `email` is the only identity
 * an external annotator can give.
 *
 * The credential is resolved inside the handler rather than by the framework's
 * authenticate-then-authorize chain, and that is deliberate rather than
 * historical: this family publishes its own refusal bodies (a bare
 * `{ message }` for an unauthenticated call, the full handled payload for a
 * ceiling denial), and deployed callers parse them. Routing it through the
 * framework chain would silently change both. So the family declares
 * `handlerManagedAuth` — which is what puts it in the route-policy registry
 * with its real permission, so an authorization audit still sees it — and takes
 * the resolution itself as a port. See {@link AnnotationRestCredentialPort}.
 */
import {
  ANNOTATION_ANCHOR_SCOPES,
  type AnnotationAnchorScope,
  AnnotationNotFoundError,
  annotationAnchorScopeSchema,
} from "@langwatch/annotation-contract";
import { handlerManagedAuth } from "@langwatch/api";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import { ValidationError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";
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
 * What a resolved project credential gives a handler, and what a refused one
 * answers with.
 *
 * `body` is the response body verbatim — a bare sentence for an unauthenticated
 * call, and the full handled payload (code, meta, tips, docsUrl, fault,
 * retryable) for a ceiling denial. The package does not build either: the first
 * is copy this family has published for years, the second is the process's own
 * error taxonomy rendered the way its error boundary renders it, and a second
 * rendering here is exactly how the two would drift.
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
 * How this process turns a request into a project credential at one grain.
 *
 * A port because resolving it reads API keys and role bindings out of the
 * deployment's database, which a feature package has none of.
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
 * Which comments a list endpoint returns. Absent means every comment on the
 * trace, each carrying the part of it that was commented on: an anchored
 * comment is the primary annotation now, so a list that left them out would
 * answer with silence exactly when a reviewer had spoken. `?anchor=trace` asks
 * for only what was said about the traces as a whole.
 */
function anchorScopeFromQuery(c: Context): AnnotationAnchorScope {
  const requested = c.req.query("anchor");
  if (requested === void 0) return "all";

  const parsed = annotationAnchorScopeSchema.safeParse(requested);
  if (!parsed.success) {
    throw new ValidationError(
      `[anchor] must be one of: ${ANNOTATION_ANCHOR_SCOPES.join(", ")}.`,
    );
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
  const secured = security.createServiceApp({ basePath: "/api" });

  const authenticate = (c: Context, permission: AnnotationRestPermission) =>
    credential({ request: c.req.raw, permission });

  // ---------- GET /api/annotations ----------
  secured.access(annotationsViewAuth).get("/annotations", async (c) => {
    const auth = await authenticate(c, "annotations:view");
    if (!auth.ok) {
      return c.json(auth.body, auth.status);
    }
    const { project, markUsed } = auth;
    const anchorScope = anchorScopeFromQuery(c);

    try {
      const rows = await annotations().list({
        projectId: project.id,
        anchor: anchorScope,
      });

      markUsed();
      return c.json({ data: rows });
    } catch (e) {
      logger.error({ error: e, projectId: project.id }, "error fetching annotations");
      return c.json(
        {
          status: "error",
          message: e instanceof Error ? e.message : "Internal server error.",
        },
        500,
      );
    }
  });

  // ---------- GET|DELETE|PATCH /api/annotations/:id ----------
  secured.access(annotationsViewAuth).get("/annotations/:id", async (c) => {
    const auth = await authenticate(c, "annotations:view");
    if (!auth.ok) {
      return c.json(auth.body, auth.status);
    }
    const { project, markUsed } = auth;

    try {
      const annotationId = c.req.param("id");
      let annotation;
      try {
        annotation = await annotations().getById({ id: annotationId, projectId: project.id });
      } catch (error) {
        if (error instanceof AnnotationNotFoundError) {
          return c.json({ status: "error", message: "Annotation not found." }, 404);
        }
        throw error;
      }
      markUsed();
      return c.json({ data: annotation });
    } catch (e) {
      logger.error({ error: e, projectId: project.id }, "error fetching annotation");
      return c.json(
        {
          status: "error",
          message: e instanceof Error ? e.message : "Internal server error.",
        },
        500,
      );
    }
  });

  secured.access(annotationsManageAuth).delete("/annotations/:id", async (c) => {
    const auth = await authenticate(c, "annotations:manage");
    if (!auth.ok) {
      return c.json(auth.body, auth.status);
    }
    const { project, markUsed } = auth;

    try {
      const annotationId = c.req.param("id");
      await annotations().delete({ id: annotationId, projectId: project.id });
      markUsed();
      return c.json({ status: "success", message: "Annotation deleted." });
    } catch (e) {
      logger.error({ error: e, projectId: project.id }, "error deleting annotation");
      return c.json(
        {
          status: "error",
          message: e instanceof Error ? e.message : "ID not found.",
        },
        500,
      );
    }
  });

  secured.access(annotationsManageAuth).patch("/annotations/:id", async (c) => {
    const auth = await authenticate(c, "annotations:manage");
    if (!auth.ok) {
      return c.json(auth.body, auth.status);
    }
    const { project, markUsed } = auth;

    try {
      const body = await c.req.json();
      const parsed = annotationRestWriteSchema.safeParse(body);
      const annotationId = c.req.param("id");
      const issues = parsed.success ? [] : parsed.error.issues;

      const commentIssue = issues.some((issue) => issue.path[0] === "comment");
      if (commentIssue) {
        return c.json(
          {
            status: "error",
            message: "[comment] is required in the request body and must be a string.",
          },
          400,
        );
      }
      const thumbsIssue = issues.some((issue) => issue.path[0] === "isThumbsUp");
      if (thumbsIssue) {
        return c.json(
          {
            status: "error",
            message: "[isThumbsUp] is required in the request body and must be a boolean.",
          },
          400,
        );
      }

      if (!parsed.success) {
        return c.json({ status: "error", message: "Invalid request body." }, 400);
      }

      const patchAnnotation = await annotations().update({
        id: annotationId,
        projectId: project.id,
        comment: parsed.data.comment,
        isThumbsUp: parsed.data.isThumbsUp,
        ...(parsed.data.email === void 0 ? {} : { email: parsed.data.email }),
      });

      markUsed();
      return c.json({ data: patchAnnotation });
    } catch (e) {
      logger.error({ error: e, projectId: project.id }, "error patching annotation");
      return c.json(
        {
          status: "error",
          message: e instanceof Error ? e.message : "Not found",
        },
        500,
      );
    }
  });

  // ---------- GET|POST /api/annotations/trace/:id ----------
  secured.access(annotationsViewAuth).get("/annotations/trace/:id", async (c) => {
    const auth = await authenticate(c, "annotations:view");
    if (!auth.ok) {
      return c.json(auth.body, auth.status);
    }
    const { project, markUsed } = auth;
    const anchorScope = anchorScopeFromQuery(c);

    try {
      const trace = c.req.param("id");
      const annotationsByTrace = await annotations().list({
        projectId: project.id,
        traceIds: [trace],
        anchor: anchorScope,
      });

      markUsed();
      return c.json({ data: annotationsByTrace });
    } catch (e) {
      logger.error(
        { error: e, trace: c.req.param("id"), projectId: project.id },
        "error fetching annotations for trace",
      );
      return c.json(
        {
          status: "error",
          message: e instanceof Error ? e.message : "Internal server error.",
        },
        500,
      );
    }
  });

  secured.access(annotationsCreateAuth).post("/annotations/trace/:id", async (c) => {
    // `:create` (not `:manage`) — same fix as evaluators' POST route. A create
    // asks for the create grain; demanding `:manage` here would refuse every
    // restricted key that can create but not delete, which is exactly how
    // `scenarios:create` produced a production 403. (`:manage` still implies
    // `:create` via the hierarchy, so nobody loses access.)
    const auth = await authenticate(c, "annotations:create");
    if (!auth.ok) {
      return c.json(auth.body, auth.status);
    }
    const { project, markUsed } = auth;

    try {
      const body = await c.req.json();
      const parsed = annotationRestWriteSchema.safeParse(body);
      const trace = c.req.param("id");
      const issues = parsed.success ? [] : parsed.error.issues;

      const commentIssue = issues.some((issue) => issue.path[0] === "comment");
      if (commentIssue) {
        return c.json(
          {
            status: "error",
            message: "[comment] is required in the request body and must be a string.",
          },
          400,
        );
      }
      const thumbsIssue = issues.some((issue) => issue.path[0] === "isThumbsUp");
      if (thumbsIssue) {
        return c.json(
          {
            status: "error",
            message: "[isThumbsUp] is required in the request body and must be a boolean.",
          },
          400,
        );
      }
      if (!trace) {
        return c.json(
          {
            status: "error",
            message: "Trace ID is required and must be a string.",
          },
          400,
        );
      }

      if (!parsed.success) {
        return c.json({ status: "error", message: "Invalid request body." }, 400);
      }

      // Unattributed on purpose: this family authenticates with a project key,
      // so there is no reviewer to credit. `email` below is the only identity an
      // external annotator gives us.
      const addAnnotation = await annotations().createUnattributed({
        id: nanoid(),
        comment: parsed.data.comment,
        projectId: project.id,
        isThumbsUp: parsed.data.isThumbsUp,
        traceId: trace,
        ...(parsed.data.email === void 0 ? {} : { email: parsed.data.email }),
        scoreOptions: {},
        expectedOutput: null,
      });

      markUsed();
      return c.json({ data: addAnnotation });
    } catch (e) {
      logger.error(
        { error: e, trace: c.req.param("id"), projectId: project.id },
        "error creating annotation",
      );
      return c.json(
        {
          status: "error",
          message: e instanceof Error ? e.message : "Internal server error.",
        },
        500,
      );
    }
  });

  return secured.hono;
}
