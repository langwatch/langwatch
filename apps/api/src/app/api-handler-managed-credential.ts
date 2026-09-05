/**
 * The project credential, resolved for a family that answers its own refusals. Most REST
 * families let the framework authenticate them: the chain resolves the credential, checks
 * the permission, and renders a refusal in whichever envelope the family declared.
 */
import { type ApiKeyService, type ResolvedApiKeyToken } from "@langwatch/api-key-contract";
import type { AuthzPermission, AuthzService } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { apiKeyCeilingRefusal } from "./api-key-ceiling-refusal";
import { extractApiKeyRequestCredentials } from "./api-key-request-credentials";

/** What a resolved credential gives a handler, or what a refused one answers. */
export type HandlerManagedCredential =
  | Readonly<{
      ok: true;
      project: ResolvedApiKeyToken["project"];
      resolved: ResolvedApiKeyToken;
      markUsed: () => void;
    }>
  | Readonly<{ ok: false; status: ContentfulStatusCode; body: object }>;

/**
 * The sentence an unauthenticated caller of these families receives. It names all three
 * accepted credential shapes because that is what it has always named, and an SDK's own
 * error copy quotes it.
 */
const MISSING_CREDENTIAL_MESSAGE =
  "Authentication token is required. Use X-Auth-Token header, Authorization: Bearer token, or Authorization: Basic base64(projectId:token).";

const INVALID_CREDENTIAL_MESSAGE = "Invalid auth token.";

export class ApiHandlerManagedCredentials {
  static create(options: {
    apiKeys: ApiKeyService;
    authz: AuthzService;
    logger?: Pick<Logger, "error">;
  }): ApiHandlerManagedCredentials {
    return new ApiHandlerManagedCredentials(
      options.apiKeys,
      options.authz,
      options.logger ?? createLogger("langwatch:api:handler-managed-credential"),
    );
  }

  private constructor(
    private readonly apiKeys: ApiKeyService,
    private readonly authz: AuthzService,
    private readonly logger: Pick<Logger, "error">,
  ) {}

  /**
   * Resolve the request's project credential and enforce one permission as an API-key
   * ceiling.
   */
  async authenticate(input: {
    request: Request;
    permission: AuthzPermission;
  }): Promise<HandlerManagedCredential> {
    const credentials = extractApiKeyRequestCredentials(input.request);
    if (!credentials) {
      return { ok: false, status: 401, body: { message: MISSING_CREDENTIAL_MESSAGE } };
    }

    const resolved = await this.apiKeys.tryResolveToken(credentials);
    if (!resolved) {
      return { ok: false, status: 401, body: { message: INVALID_CREDENTIAL_MESSAGE } };
    }

    if (resolved.type === "apiKey") {
      const allowed = await this.isWithinCeiling({
        resolved,
        permission: input.permission,
      });
      if (!allowed) {
        const refusal = apiKeyCeilingRefusal(resolved, input.permission, this.logger);
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
      resolved,
      markUsed: () => {
        if (resolved.type === "apiKey") {
          this.apiKeys.markUsed({ id: resolved.apiKeyId });
        }
      },
    };
  }

  /**
   * Enforces one permission as an ALREADY-RESOLVED key's ceiling, THROWING the same
   * refusal {@link authenticate} would have answered with.
   */
  async enforceCeiling(input: {
    resolved: ResolvedApiKeyToken;
    permission: AuthzPermission;
  }): Promise<void> {
    // A legacy project key has no per-permission ceiling: project keys predate
    // RBAC and carry full project access by design, so a route's declared
    // permission is decorative for that credential class.
    if (input.resolved.type !== "apiKey") return;
    const allowed = await this.isWithinCeiling({
      resolved: input.resolved,
      permission: input.permission,
    });
    if (!allowed) throw apiKeyCeilingRefusal(input.resolved, input.permission, this.logger);
  }

  private isWithinCeiling(input: {
    resolved: Extract<ResolvedApiKeyToken, { type: "apiKey" }>;
    permission: AuthzPermission;
  }): Promise<boolean> {
    const { resolved, permission } = input;
    return this.authz.hasApiKeyPermission({
      apiKeyId: resolved.apiKeyId,
      userId: resolved.userId ?? null,
      organizationId: resolved.organizationId,
      scope: {
        type: "project",
        id: resolved.project.id,
        teamId: resolved.project.teamId,
      },
      permission,
    });
  }
}

/**
 * The wire body for a handled error answered by a middleware rather than by an error
 * boundary: the code as the discriminant, the sentence, the meta bag spread flat, and the
 * remediation channel alongside. The same shape the process's own error boundary writes.
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
