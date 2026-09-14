/**
 * How the deprecated `/api/trace/*` family resolves its own project credential.
 *
 * The family is declared `publicRoute` on purpose (see
 * `transport/trace-legacy.rest.ts`): its refusals predate the framework's
 * envelope and a released SDK parses them, so the door cannot be the framework's
 * and the sentences below are the contract. This service is the door, moved into
 * the module that owns the routes — it used to live in the process, as
 * `ApiHandlerManagedCredentials`, and was lost with the deleted mounts.
 *
 * ORDER IS THE CONTRACT: credential present (401), credential resolves (401),
 * then the API key's own ceiling for the permission the route asked for (403).
 */
import type { ApiKeyApi, ResolvedApiKeyCredential } from "@langwatch/api-key-contract";
import { ApiKeyPermissionDeniedError } from "@langwatch/api-key-contract";
import { credentialPrincipalOfToken } from "@langwatch/api/rest";
import type { AuthzApi, AuthzPermission } from "@langwatch/authz-contract";
import type { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { TraceLegacyCredential } from "../../transport/trace-legacy.rest.ts";

/**
 * The sentence an unauthenticated caller of this family receives. It names all
 * three accepted credential shapes because that is what it has always named,
 * and an SDK's own error copy quotes it.
 */
export const TRACE_LEGACY_MISSING_CREDENTIAL_MESSAGE =
  "Authentication token is required. Use X-Auth-Token header, Authorization: Bearer token, or Authorization: Basic base64(projectId:token).";

/** What an unresolvable token receives. Deliberately says nothing about why. */
export const TRACE_LEGACY_INVALID_CREDENTIAL_MESSAGE = "Invalid auth token.";

/** A token read off a request, and the project it named where one was given. */
export type TraceLegacyRequestCredentials = Readonly<{
  token: string;
  projectId: string | null;
}>;

/**
 * Preserves the credential precedence this deployment publishes across every
 * REST family: valid Basic, then non-empty Bearer, then `X-Auth-Token`.
 */
export function readTraceLegacyRequestCredentials(
  request: Request,
): TraceLegacyRequestCredentials | null {
  const authorization = request.headers.get("authorization");
  const xAuthToken = request.headers.get("x-auth-token");
  const xProjectId = request.headers.get("x-project-id");

  if (authorization?.toLowerCase().startsWith("basic ")) {
    const parsed = parseBasicCredentials(authorization.slice(6));
    if (parsed) return parsed;
  }

  if (authorization?.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice(7).trim();
    if (token) return { token, projectId: xProjectId };
  }

  return xAuthToken ? { token: xAuthToken, projectId: xProjectId } : null;
}

function parseBasicCredentials(value: string): TraceLegacyRequestCredentials | null {
  try {
    const decoded = Buffer.from(value, "base64").toString("utf-8");
    const separator = decoded.indexOf(":");
    if (separator < 1 || separator === decoded.length - 1) return null;
    return { projectId: decoded.slice(0, separator), token: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

/** The two peers this door reads, and nothing else. */
export type TraceLegacyCredentialOptions = Readonly<{
  apiKeys: ApiKeyApi;
  authz: Pick<AuthzApi, "hasApiKeyPermission">;
  logger?: Pick<Logger, "error"> | undefined;
}>;

export class TraceLegacyCredentialService {
  static create(options: TraceLegacyCredentialOptions): TraceLegacyCredentialService {
    return new TraceLegacyCredentialService(
      options.apiKeys,
      options.authz,
      options.logger ?? createLogger("langwatch:trace:legacy-credential"),
    );
  }

  #apiKeys: ApiKeyApi;
  #authz: Pick<AuthzApi, "hasApiKeyPermission">;
  #logger: Pick<Logger, "error">;

  private constructor(
    apiKeys: ApiKeyApi,
    authz: Pick<AuthzApi, "hasApiKeyPermission">,
    logger: Pick<Logger, "error">,
  ) {
    this.#apiKeys = apiKeys;
    this.#authz = authz;
    this.#logger = logger;
  }

  /**
   * Resolves the request's project credential and enforces one permission as
   * the API key's ceiling. Answers a refusal rather than throwing one: this
   * family writes its own bodies, and a thrown `HandledError` would reach the
   * caller in the framework's envelope instead.
   */
  async resolve(input: {
    request: Request;
    permission: "traces:view" | "traces:share";
  }): Promise<TraceLegacyCredential> {
    const credentials = readTraceLegacyRequestCredentials(input.request);
    if (!credentials) {
      return {
        ok: false,
        status: 401,
        body: { message: TRACE_LEGACY_MISSING_CREDENTIAL_MESSAGE },
      };
    }

    const resolved = await this.#apiKeys.findResolvedToken(credentials);
    if (!resolved) {
      return {
        ok: false,
        status: 401,
        body: { message: TRACE_LEGACY_INVALID_CREDENTIAL_MESSAGE },
      };
    }

    // A legacy project key has no per-permission ceiling: project keys predate
    // RBAC and carry full project access by design.
    if (resolved.type === "apiKey") {
      const allowed = await this.#withinCeiling(resolved, input.permission);
      if (!allowed) {
        const refusal = this.#ceilingRefusal(resolved, input.permission);
        return {
          ok: false,
          status: refusal.httpStatus as ContentfulStatusCode,
          body: handledErrorResponseBody(refusal),
        };
      }
    }

    return {
      ok: true,
      project: resolved.project,
      // The resolved token becomes the family's principal, so its handlers ask
      // a second question of the KEY rather than of whoever holds it.
      credential: credentialPrincipalOfToken(resolved),
      markUsed: () => {
        if (resolved.type === "apiKey") this.#apiKeys.markUsed({ id: resolved.apiKeyId });
      },
    };
  }

  #withinCeiling(
    resolved: Extract<ResolvedApiKeyCredential, { type: "apiKey" }>,
    permission: AuthzPermission,
  ): Promise<boolean> {
    return this.#authz.hasApiKeyPermission({
      apiKeyId: resolved.apiKeyId,
      userId: resolved.userId ?? null,
      organizationId: resolved.organizationId,
      scope: { type: "project", id: resolved.project.id, teamId: resolved.project.teamId },
      permission,
    });
  }

  #ceilingRefusal(
    resolved: Extract<ResolvedApiKeyCredential, { type: "apiKey" }>,
    permission: AuthzPermission,
  ): HandledError {
    this.#logger.error(
      {
        apiKeyId: resolved.apiKeyId,
        userId: resolved.userId ?? null,
        projectId: resolved.project.id,
        permission,
      },
      "API key ceiling denial",
    );
    return new ApiKeyPermissionDeniedError(permission);
  }
}

/**
 * The wire body for a handled error answered by a door rather than by an error
 * boundary: the code as the discriminant, the sentence, the meta bag spread
 * flat, and the remediation channel alongside.
 */
function handledErrorResponseBody(error: HandledError): object {
  const { code, message, meta, tips, docsUrl, fault, retryable } = error;
  return {
    error: code,
    message,
    ...meta,
    ...(tips?.length ? { tips } : {}),
    ...(docsUrl ? { docsUrl } : {}),
    ...(fault ? { fault } : {}),
    retryable: retryable === true,
  };
}
