/**
 * Hono routes for annotations.
 *
 * Replaces:
 * - src/pages/api/annotations/index.ts
 * - src/pages/api/annotations/[id].ts
 * - src/pages/api/annotations/trace/[trace].ts
 */

import {
  ANNOTATION_ANCHOR_SCOPES,
  type AnnotationAnchorScope,
  AnnotationNotFoundError,
  annotationAnchorScopeSchema,
} from "@langwatch/annotation-contract";
import { ValidationError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { Permission } from "~/server/api/rbac";
import { createServiceApp } from "~/server/api/security";
import { handlerManagedAuth } from "@langwatch/platform-api/app-rest";
import {
  apiKeyCeilingDenialResponse,
  enforceApiKeyCeiling,
  extractCredentials,
} from "~/server/api-key/auth-middleware";

const logger = createLogger("langwatch:annotations");
const AUTH_REASON =
  "project API key resolved by context.app.apiKeys and checked with enforceApiKeyCeiling";

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

const secured = createServiceApp({ basePath: "/api" });

/**
 * Authenticates via the unified API-key + legacy-key path and enforces the given
 * permission ceiling. Returns either a `{ project, markUsed }` context or an
 * error descriptor whose `body` the caller surfaces via c.json(...) — a bare
 * sentence for an unauthenticated call, and the full handled payload (code,
 * permission, tips) for a permission denial. `markUsed` is fire-and-forget and
 * a no-op for legacy keys.
 */
async function authenticateRequest(c: Context, permission: Permission) {
  const credentials = extractCredentials((name) => c.req.header(name));
  if (!credentials) {
    const message =
      "Authentication token is required. Use X-Auth-Token header, Authorization: Bearer token, or Authorization: Basic base64(projectId:token).";
    return { error: message, status: 401 as const, body: { message } };
  }

  const apiKeys = c.app.apiKeys.apiKeyService;
  const resolved = await apiKeys.tryResolveToken({
    token: credentials.token,
    projectId: credentials.projectId,
  });
  if (!resolved) {
    const message = "Invalid auth token.";
    return { error: message, status: 401 as const, body: { message } };
  }

  try {
    await enforceApiKeyCeiling({ resolved, permission });
  } catch (error) {
    const denial = apiKeyCeilingDenialResponse(error);
    return {
      error: denial.message,
      status: denial.status,
      body: denial.body,
    };
  }

  const markUsed = () => {
    if (resolved.type === "apiKey") {
      apiKeys.markUsed({ id: resolved.apiKeyId });
    }
  };

  return { project: resolved.project, markUsed };
}

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

// ---------- GET /api/annotations ----------
secured.access(annotationsViewAuth).get("/annotations", async (c) => {
  const auth = await authenticateRequest(c, "annotations:view");
  if ("error" in auth) {
    return c.json(auth.body, auth.status);
  }
  const { project, markUsed } = auth;
  const anchorScope = anchorScopeFromQuery(c);
  const annotations = c.app.annotations;

  try {
    const rows = await annotations.list({
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
  const auth = await authenticateRequest(c, "annotations:view");
  if ("error" in auth) {
    return c.json(auth.body, auth.status);
  }
  const { project, markUsed } = auth;
  const annotations = c.app.annotations;

  try {
    const annotationId = c.req.param("id");
    let annotation;
    try {
      annotation = await annotations.getById({ id: annotationId, projectId: project.id });
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
  const auth = await authenticateRequest(c, "annotations:manage");
  if ("error" in auth) {
    return c.json(auth.body, auth.status);
  }
  const { project, markUsed } = auth;
  const annotations = c.app.annotations;

  try {
    const annotationId = c.req.param("id");
    await annotations.delete({ id: annotationId, projectId: project.id });
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
  const auth = await authenticateRequest(c, "annotations:manage");
  if ("error" in auth) {
    return c.json(auth.body, auth.status);
  }
  const { project, markUsed } = auth;
  const annotations = c.app.annotations;

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

    const patchAnnotation = await annotations.update({
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
  const auth = await authenticateRequest(c, "annotations:view");
  if ("error" in auth) {
    return c.json(auth.body, auth.status);
  }
  const { project, markUsed } = auth;
  const anchorScope = anchorScopeFromQuery(c);
  const annotations = c.app.annotations;

  try {
    const trace = c.req.param("id");
    const annotationsByTrace = await annotations.list({
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
  // `:create` (not `:manage`) — same fix as evaluators' POST route. Creating
  // is a lesser privilege than update/delete, and LANGY_CANDIDATE_PERMISSIONS
  // only ever grants annotations:create, never :manage. PATCH/DELETE above
  // correctly stay on :manage.
  const auth = await authenticateRequest(c, "annotations:create");
  if ("error" in auth) {
    return c.json(auth.body, auth.status);
  }
  const { project, markUsed } = auth;
  const annotations = c.app.annotations;

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
    const addAnnotation = await annotations.createUnattributed({
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

export const app = secured.hono;
