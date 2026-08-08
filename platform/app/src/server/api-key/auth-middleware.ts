import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { Organization, PrismaClient, Project } from "@prisma/client";
import type { MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { handledErrorResponseBody } from "~/app/api/middleware/error-handler";
import {
  type ApiErrorEnvelope,
  authRefusalBody,
  canonicalErrorFor,
  requestTraceIds,
} from "~/app/api/shared/canonical-error";
import type { Permission } from "~/server/api/rbac";
import { resolveApiKeyPermission } from "~/server/rbac/role-binding-resolver";
import { getTokenType } from "./api-key-token.utils";
import { ApiKeyPermissionDeniedError } from "./errors";
import {
  type OrgResolvedToken,
  type ResolvedToken,
  TokenResolver,
} from "./token-resolver";

const logger = createLogger("langwatch:api:unified-auth");
const permissionLogger = createLogger("langwatch:api:api-key-ceiling");

/**
 * Variables set by the unified auth middleware.
 */
export type UnifiedAuthVariables = {
  project: Project;
  /** Set when the request was authenticated via API key (not legacy project key) */
  apiKeyId?: string;
  /** The user ID from the API key (not set for legacy project keys) */
  apiKeyUserId?: string;
  /** The organization ID from the API key */
  apiKeyOrganizationId?: string;
  /** The resolved token details */
  resolvedToken?: ResolvedToken;
};

/**
 * Parses the Authorization header to extract credentials for all supported
 * auth methods:
 *   1. Basic Auth: base64(projectId:token) — for SDKs
 *   2. Bearer: sk-lw-... or pat-lw-... + X-Project-Id header
 *   3. X-Auth-Token: legacy header (any token type)
 */
function extractCredentials(
  getHeader: (name: string) => string | undefined,
): { token: string; projectId: string | null } | null {
  const authHeader = getHeader("authorization");
  const xAuthToken = getHeader("x-auth-token");
  const xProjectId = getHeader("x-project-id");

  // Priority 1: Basic Auth — carries both projectId and token
  if (authHeader?.toLowerCase().startsWith("basic ")) {
    const encoded = authHeader.slice(6);
    try {
      const decoded = Buffer.from(encoded, "base64").toString("utf-8");
      const colonIndex = decoded.indexOf(":");
      if (colonIndex !== -1) {
        const projectId = decoded.slice(0, colonIndex);
        const token = decoded.slice(colonIndex + 1);
        if (projectId && token) {
          return { token, projectId };
        }
      }
      // Fall through to X-Auth-Token below: a malformed Basic header (e.g.
      // injected by a corporate proxy for upstream auth) must not poison
      // the customer's legitimate X-Auth-Token credential.
    } catch {
      // Same fallthrough on undecodable base64.
    }
  }

  // Priority 2: Bearer token
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) {
      return { token, projectId: xProjectId ?? null };
    }
    // Empty Bearer also falls through to X-Auth-Token — same proxy-injection
    // hardening as Basic above.
  }

  // Priority 3: X-Auth-Token header (legacy)
  if (xAuthToken) {
    return { token: xAuthToken, projectId: xProjectId ?? null };
  }

  return null;
}

/**
 * Unified Hono auth middleware that handles all auth methods:
 *   - Basic Auth (base64 decode projectId:token)
 *   - Bearer API key (Authorization: Bearer sk-lw-... + X-Project-Id header)
 *   - Legacy (X-Auth-Token: sk-lw-... unchanged)
 *
 * Sets `project`, `apiKeyId`, `apiKeyUserId`, `apiKeyOrganizationId` on context.
 *
 * markUsed is late — called only after `next()` returns a 2xx response.
 */
export function createUnifiedAuthMiddleware({
  prisma,
  errorEnvelope = "legacy",
}: {
  prisma: PrismaClient;
  /**
   * The shape refusals answer with. Authentication runs beneath the family's
   * own error handler, so a family publishing the canonical envelope must not
   * answer a flat body when the request fails one layer earlier.
   */
  errorEnvelope?: ApiErrorEnvelope;
}): MiddlewareHandler {
  const resolver = TokenResolver.create(prisma);
  const refusal = authRefusalBody(errorEnvelope);

  return async (c, next) => {
    const outcome = await resolveProjectPrincipal({
      resolver,
      // Diagnostic context for auth failures — lets on-call attribute a 401 to
      // a specific customer/SDK without needing the customer to reproduce with
      // debug logs. Read once and reused across every failure path so values
      // are consistent. No raw token / body content is included.
      diag: collectAuthDiagnostics(c),
      credentials: extractCredentials((name) => c.req.header(name)),
    });

    if (!outcome.ok) {
      return c.json(
        refusal(outcome.refusal),
        outcome.refusal.status as 401 | 500,
      );
    }

    const { resolved } = outcome;
    c.set("project", resolved.project);
    c.set("resolvedToken", resolved);

    if (resolved.type === "apiKey") {
      c.set("apiKeyId", resolved.apiKeyId);
      c.set("apiKeyUserId", resolved.userId);
      c.set("apiKeyOrganizationId", resolved.organizationId);
    }

    await next();

    // Late markUsed: only when the handler produced a success response.
    if (
      resolved.type === "apiKey" &&
      c.res.status >= 200 &&
      c.res.status < 300
    ) {
      resolver.markUsed({ apiKeyId: resolved.apiKeyId });
    }
  };
}

/**
 * The project credential behind a request, or the reason there isn't one.
 *
 * Split out so the middleware above reads as "resolve, then set context",
 * mirroring {@link resolveOrgPrincipal}: every refusal is described here as
 * data and rendered into the family's envelope by its one caller, so no branch
 * can answer in the wrong shape. The codes match the org path's, because both
 * families serve the same URL prefixes and a caller branching on
 * `error.code` must not have to learn which one answered.
 */
async function resolveProjectPrincipal({
  resolver,
  credentials,
  diag,
}: {
  resolver: TokenResolver;
  credentials: { token: string; projectId: string | null } | null;
  diag: AuthDiagnostics;
}): Promise<
  { ok: true; resolved: ResolvedToken } | { ok: false; refusal: AuthRefusal }
> {
  if (!credentials) {
    logger.warn(
      diag,
      diag.hasEmptyAuthToken
        ? "Authentication failed: X-Auth-Token sent but empty"
        : "Authentication failed: no auth header present",
    );
    return {
      ok: false,
      refusal: {
        status: 401,
        code: "missing_credentials",
        legacyError: "Unauthorized",
        message:
          "Authentication required. Use Authorization: Basic base64(projectId:token), Authorization: Bearer <token>, or X-Auth-Token header.",
      },
    };
  }

  let resolved: ResolvedToken | null;
  try {
    resolved = await resolver.resolve({
      token: credentials.token,
      projectId: credentials.projectId,
    });
  } catch (error) {
    logger.error({ ...diag, error }, "Database error during authentication");
    return {
      ok: false,
      refusal: {
        status: 500,
        code: "internal_error",
        legacyError: "Internal Server Error",
        message: "Authentication service error",
      },
    };
  }

  if (!resolved) {
    logger.warn(
      {
        ...diag,
        hasToken: true,
        tokenType: getTokenType(credentials.token),
        hasProjectId: !!credentials.projectId,
      },
      "Authentication failed: invalid credentials",
    );
    return {
      ok: false,
      refusal: {
        status: 401,
        code: "invalid_credentials",
        legacyError: "Unauthorized",
        message: "Invalid credentials",
      },
    };
  }

  return { ok: true, resolved };
}

export { extractCredentials };

/**
 * Variables set by the org-level auth middleware.
 */
export type OrgAuthVariables = {
  organization: Organization;
  apiKeyId: string;
  apiKeyUserId: string | null;
  apiKeyOrganizationId: string;
  orgResolvedToken: OrgResolvedToken;
};

/**
 * A refusal from {@link createOrgAuthMiddleware} in its throwing mode.
 *
 * One class for the three auth refusals rather than one each, because the
 * refusal descriptors in {@link resolveOrgPrincipal} are the single source of
 * code, message and status for BOTH modes; a per-code subclass would be a
 * second place for those to drift apart. Callers branch on `error.code`
 * (`missing_credentials` / `invalid_credentials` / `organization_not_found`),
 * which is the cross-boundary discriminant anyway (ADR-045).
 */
export class OrgAuthRefusedError extends HandledError {
  constructor(refusal: AuthRefusal) {
    super(refusal.code, refusal.message, {
      httpStatus: refusal.status,
      // A refusal is the credential's problem; anything 5xx reaching here is
      // not, and must not be logged as routine customer noise.
      fault: refusal.status >= 500 ? "platform" : "customer",
    });
    this.name = "OrgAuthRefusedError";
  }
}

/**
 * Org-level Hono auth middleware for endpoints that operate at the
 * organization level (e.g. project CRUD). Only accepts API key tokens —
 * legacy project keys are rejected since they lack org context.
 *
 * Sets `organization`, `apiKeyId`, `apiKeyUserId`, `apiKeyOrganizationId` on context.
 * Does NOT set `project` — callers that need project context should use
 * the standard project-scoped auth middleware instead.
 *
 * `errorEnvelope` picks the shape refusals answer with, because that shape is
 * a property of the route family's published contract, not of the auth check:
 * a family that emits the canonical envelope from its handlers must not
 * answer a flat body when the same request fails one layer earlier. Families
 * predating the envelope stay on `legacy` until they migrate deliberately.
 *
 * `refusals` picks WHO turns a refusal into a response. The default,
 * `"respond"`, answers here in the family's `errorEnvelope`, unchanged for
 * every existing consumer. `"throw"` raises the same refusal as a
 * `HandledError` instead (`missing_credentials` / `invalid_credentials` /
 * `organization_not_found`, via {@link OrgAuthRefusedError}) so a family whose
 * error handler owns the response shape serialises auth refusals exactly like
 * its domain errors. A database failure during auth is not a refusal and stays
 * a plain error in throw mode: it rethrows as-is and degrades to the generic
 * unknown response at the boundary (ADR-045), rather than being dressed up as
 * handled.
 */
export function createOrgAuthMiddleware({
  prisma,
  errorEnvelope = "legacy",
  refusals = "respond",
}: {
  prisma: PrismaClient;
  errorEnvelope?: ApiErrorEnvelope;
  refusals?: "respond" | "throw";
}): MiddlewareHandler {
  const resolver = TokenResolver.create(prisma);
  const orgLogger = createLogger("langwatch:api:org-auth");
  const refusal = authRefusalBody(errorEnvelope);

  return async (c, next) => {
    const outcome = await resolveOrgPrincipal({
      prisma,
      resolver,
      orgLogger,
      credentials: extractCredentials((name) => c.req.header(name)),
      diag: collectAuthDiagnostics(c),
    });

    if (!outcome.ok) {
      if (refusals === "throw") raiseOrgAuthRefusal(outcome.refusal);
      return c.json(refusal(outcome.refusal), outcome.refusal.status as 401);
    }

    const { organization, resolved } = outcome;
    c.set("organization", organization);
    c.set("apiKeyId", resolved.apiKeyId);
    c.set("apiKeyUserId", resolved.userId);
    c.set("apiKeyOrganizationId", resolved.organizationId);
    c.set("orgResolvedToken", resolved);

    await next();

    if (c.res.status >= 200 && c.res.status < 300) {
      resolver.markUsed({ apiKeyId: resolved.apiKeyId });
    }
  };
}

/**
 * A refusal an auth check answers with, before it has an envelope.
 *
 * Shared by the project- and org-scoped resolvers so the two cannot describe
 * the same failure differently.
 */
type AuthRefusal = {
  status: number;
  code: string;
  legacyError: string;
  message: string;
  /**
   * Set when the refusal is an infrastructure failure rather than a credential
   * problem. Only the throwing mode reads it: it rethrows the underlying error
   * plain instead of minting a handled one. Carried as its own flag rather
   * than inferred from `cause`, because a rejection whose value is `undefined`
   * is still an infrastructure failure. The responding mode ignores both, so
   * its bodies are unchanged by these fields existing.
   */
  isInfrastructureFailure?: boolean;
  cause?: unknown;
};

/**
 * Turns a refusal into the exception the throwing mode raises. An
 * infrastructure failure is rethrown plain so it stays an unhandled 500, not a
 * fake handled one; a non-Error rejection value is wrapped so the boundary
 * still receives a stack.
 */
function raiseOrgAuthRefusal(refusal: AuthRefusal): never {
  if (refusal.isInfrastructureFailure) {
    if (refusal.cause instanceof Error) throw refusal.cause;
    throw new Error(refusal.message, { cause: refusal.cause });
  }
  throw new OrgAuthRefusedError(refusal);
}

/**
 * The organization behind a credential, or the reason there isn't one.
 *
 * Split out so the middleware above reads as "resolve, then set context":
 * every refusal is described here as data and rendered into the family's
 * envelope by its one caller, so no branch can answer in the wrong shape.
 */
async function resolveOrgPrincipal({
  prisma,
  resolver,
  orgLogger,
  credentials,
  diag,
}: {
  prisma: PrismaClient;
  resolver: TokenResolver;
  orgLogger: ReturnType<typeof createLogger>;
  credentials: { token: string; projectId: string | null } | null;
  diag: AuthDiagnostics;
}): Promise<
  | { ok: true; organization: Organization; resolved: OrgResolvedToken }
  | { ok: false; refusal: AuthRefusal }
> {
  if (!credentials) {
    orgLogger.warn(diag, "Org auth failed: no credentials");
    return {
      ok: false,
      refusal: {
        status: 401,
        code: "missing_credentials",
        legacyError: "Unauthorized",
        message:
          "Authentication required. Use Authorization: Bearer <api-key>.",
      },
    };
  }

  let resolved: OrgResolvedToken | null;
  try {
    resolved = await resolver.resolveOrgOnly({ token: credentials.token });
  } catch (error) {
    orgLogger.error({ ...diag, error }, "Database error during org auth");
    return {
      ok: false,
      refusal: {
        status: 500,
        code: "internal_error",
        legacyError: "Internal Server Error",
        message: "Authentication service error",
        isInfrastructureFailure: true,
        cause: error,
      },
    };
  }

  if (!resolved) {
    orgLogger.warn(
      { ...diag, hasToken: true },
      "Org auth failed: invalid credentials",
    );
    return {
      ok: false,
      refusal: {
        status: 401,
        code: "invalid_credentials",
        legacyError: "Unauthorized",
        message:
          "Invalid credentials. Organization-level endpoints require an admin API key created in Settings > API Keys. Project API keys cannot be used here.",
      },
    };
  }

  const organization = await prisma.organization.findUnique({
    where: { id: resolved.organizationId },
  });

  if (!organization) {
    orgLogger.warn(
      { ...diag, organizationId: resolved.organizationId },
      "Org auth failed: organization not found",
    );
    return {
      ok: false,
      refusal: {
        status: 401,
        code: "organization_not_found",
        legacyError: "Unauthorized",
        message: "Organization not found",
      },
    };
  }

  return { ok: true, organization, resolved };
}

/**
 * Diagnostic fields safe to emit on auth failure. Captures enough request
 * fingerprint to attribute 401s to a specific customer/SDK in CloudWatch
 * without leaking credentials or request bodies. `traceparent` lets us join
 * the failed POST to the customer's downstream OTel trace, which usually
 * carries identifying metadata even when the auth header path doesn't.
 *
 * `hasEmptyAuthToken` distinguishes "X-Auth-Token sent as an empty string"
 * (typically a customer-side env-var misconfig) from "no auth header at all"
 * (typically a misconfigured SDK or unauthenticated probe). Both produce the
 * same 401 today — the log line tells them apart.
 */
export type AuthDiagnostics = {
  path: string;
  method: string;
  userAgent: string | null;
  traceparent: string | null;
  forwardedFor: string | null;
  hasEmptyAuthToken: boolean;
};

export function collectAuthDiagnostics(c: {
  req: {
    path: string;
    method: string;
    header: (name: string) => string | undefined;
  };
}): AuthDiagnostics {
  const get = (name: string) => c.req.header(name) ?? null;
  const xAuthToken = c.req.header("x-auth-token");
  return {
    path: c.req.path,
    method: c.req.method,
    userAgent: get("user-agent"),
    traceparent: get("traceparent"),
    forwardedFor: get("x-forwarded-for") ?? get("x-real-ip"),
    // Sent-but-empty is distinct from absent (SDK with a misconfigured
    // empty api_key still serializes the header).
    hasEmptyAuthToken: xAuthToken !== undefined && xAuthToken === "",
  };
}

/**
 * Enforces the API key permission ceiling for an already-resolved token.
 *
 * Legacy project keys are granted full access (current behavior — project API
 * keys bypass RBAC). API keys must satisfy `effective = ApiKey ∩ user` at the
 * project scope for the requested permission.
 *
 * Throws `ApiKeyPermissionDeniedError` when denied.
 */
export async function enforceApiKeyCeiling({
  prisma,
  resolved,
  permission,
}: {
  prisma: PrismaClient;
  resolved: ResolvedToken;
  permission: Permission;
}): Promise<void> {
  if (resolved.type !== "apiKey") return;

  const allowed = await resolveApiKeyPermission({
    prisma,
    apiKeyId: resolved.apiKeyId,
    userId: resolved.userId,
    organizationId: resolved.organizationId,
    scope: {
      type: "project",
      id: resolved.project.id,
      teamId: resolved.project.team.id,
    },
    permission,
  });

  if (!allowed) {
    permissionLogger.warn(
      {
        apiKeyId: resolved.apiKeyId,
        userId: resolved.userId,
        projectId: resolved.project.id,
        permission,
      },
      "API key ceiling check failed",
    );
    throw new ApiKeyPermissionDeniedError(permission, {
      meta: {
        apiKeyId: resolved.apiKeyId,
        userId: resolved.userId,
        projectId: resolved.project.id,
      },
    });
  }
}

/**
 * Converts an API key permission denial into the status + JSON body a route
 * should answer with. Re-throws anything that isn't an
 * `ApiKeyPermissionDeniedError`.
 *
 * `body` is the SAME body `onError → handleError` produces, and the same one
 * `requireApiKeyPermission` below already answers with — the two paths through
 * this ceiling had drifted, and only one of them was migrated. The hand-built
 * `{ error: "Forbidden", message }` this replaced threw away everything a
 * caller can act on: the `api_key_permission_denied` code, the permission in
 * `meta`, and the tips/docsUrl the remediation channel exists to deliver
 * (ADR-045). A CLI was left with a sentence and no code to branch on.
 *
 * `message` is kept alongside for callers that only render a sentence; it is
 * the same string `body.message` carries.
 */
export function apiKeyCeilingDenialResponse(error: unknown): {
  status: ContentfulStatusCode;
  body: object;
  message: string;
} {
  if (
    HandledError.isHandled(error) &&
    error.code === "api_key_permission_denied"
  ) {
    const { statusCode, body } = handledErrorResponseBody(error);
    return { status: statusCode, body, message: error.message };
  }
  throw error;
}

/**
 * Hono middleware that applies the API key ceiling for a specific permission.
 * Must be chained AFTER createUnifiedAuthMiddleware — reads `resolvedToken`
 * from context.
 */
export function requireApiKeyPermission({
  prisma,
  permission,
  errorEnvelope = "legacy",
}: {
  prisma: PrismaClient;
  permission: Permission;
  errorEnvelope?: ApiErrorEnvelope;
}): MiddlewareHandler {
  return async (c, next) => {
    const resolved = c.get("resolvedToken") as ResolvedToken | undefined;
    if (!resolved) {
      await next();
      return;
    }

    try {
      await enforceApiKeyCeiling({ prisma, resolved, permission });
    } catch (error) {
      if (!HandledError.isHandled(error)) throw error;
      // The ceiling refuses BENEATH the family's own error handler, so it has
      // to render whichever shape the family publishes. On `canonical` that is
      // the same envelope `canonicalErrorResponse` would have produced; on
      // `legacy` it is the SAME body `onError -> handleError` produces.
      //
      // Either way the refusal keeps everything a caller can act on: the
      // `api_key_permission_denied` code, the permission in `meta`, and the
      // tips/docsUrl the remediation channel exists to deliver (ADR-045). A
      // hand-built `{ error: "Forbidden", message }` left a CLI with a
      // sentence and no code, and the panel with nothing to put on the card
      // but "this didn't work".
      if (errorEnvelope === "canonical") {
        const { status, body } = canonicalErrorFor(error, requestTraceIds(c));
        return c.json(body, status);
      }
      const { statusCode, body } = handledErrorResponseBody(error);
      return c.json(body, statusCode);
    }

    await next();
  };
}
