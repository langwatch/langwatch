/**
 * The project credential, resolved for a family that answers its own refusals.
 *
 * Most REST families let the framework authenticate them: the chain resolves
 * the credential, checks the permission, and renders a refusal in whichever
 * envelope the family declared. A handful cannot, because they publish refusal
 * bodies that predate both envelopes and that deployed clients parse — a bare
 * `{ message }` for an unauthenticated call, and the full handled payload for a
 * ceiling denial. Routing those through the chain would change the wire.
 *
 * So they take a port instead, and this is the process's one implementation of
 * it. It resolves through the SAME `ApiKeyService` and `AuthzService` the
 * framework chain uses and refuses with the SAME two errors
 * (`ApiKeyPermissionDeniedError` / `ApiKeyPermissionNotDelegableError`), so the
 * two doors cannot decide differently about a caller; only the shape of the
 * sentence they write differs, which is the whole point of the port.
 *
 * The bodies below are transcribed from the routes that published them, not
 * invented: changing one is a wire change and belongs in a deliberate
 * deprecation, not in a refactor.
 */
import {
  ApiKeyPermissionDeniedError,
  ApiKeyPermissionNotDelegableError,
  type ApiKeyService,
  type ResolvedApiKeyToken,
} from "@langwatch/api-key-contract";
import type { AuthzPermission, AuthzService } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { classifyForLangy } from "@langwatch/langy-contract";
import type { ContentfulStatusCode } from "hono/utils/http-status";

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
 * The sentence an unauthenticated caller of these families receives.
 *
 * It names all three accepted credential shapes because that is what it has
 * always named, and an SDK's own error copy quotes it.
 */
const MISSING_CREDENTIAL_MESSAGE =
  "Authentication token is required. Use X-Auth-Token header, Authorization: Bearer token, or Authorization: Basic base64(projectId:token).";

const INVALID_CREDENTIAL_MESSAGE = "Invalid auth token.";

export class ApiHandlerManagedCredentials {
  static create(options: {
    apiKeys: ApiKeyService;
    authz: AuthzService;
  }): ApiHandlerManagedCredentials {
    return new ApiHandlerManagedCredentials(options.apiKeys, options.authz);
  }

  private constructor(
    private readonly apiKeys: ApiKeyService,
    private readonly authz: AuthzService,
  ) {}

  /**
   * Resolve the request's project credential and enforce one permission as an
   * API-key ceiling.
   *
   * A legacy project key is NOT permission-checked: project keys predate RBAC
   * and carry full project access by design, so a route's declared permission
   * is decorative for that credential class. Only scoped API keys are checked.
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
      const allowed = await this.authz.hasApiKeyPermission({
        apiKeyId: resolved.apiKeyId,
        userId: resolved.userId ?? null,
        organizationId: resolved.organizationId,
        scope: {
          type: "project",
          id: resolved.project.id,
          teamId: resolved.project.teamId,
        },
        permission: input.permission,
      });
      if (!allowed) {
        const refusal = ceilingRefusal(resolved, input.permission);
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
}

/**
 * Which refusal a scoped key gets when it lacks a permission.
 *
 * A Langy session key that asks for something Langy may never delegate is a
 * DIFFERENT refusal from an ordinary key that simply lacks the grant — the
 * first can never be fixed by widening the key, and saying so is the point.
 * Identical to the framework chain's own choice, deliberately.
 */
function ceilingRefusal(
  resolved: Extract<ResolvedApiKeyToken, { type: "apiKey" }>,
  permission: AuthzPermission,
): HandledError {
  const meta = {
    apiKeyId: resolved.apiKeyId,
    userId: resolved.userId ?? null,
    projectId: resolved.project.id,
  };
  const langy = resolved.isLangySessionKey ? classifyForLangy(permission) : null;
  if (langy && langy.disposition !== "granted") {
    return new ApiKeyPermissionNotDelegableError(permission, { subject: "Langy", meta });
  }
  return new ApiKeyPermissionDeniedError(permission, { meta });
}

/**
 * The wire body for a handled error answered by a middleware rather than by an
 * error boundary: the code as the discriminant, the sentence, the meta bag
 * spread flat, and the remediation channel alongside.
 *
 * The same shape the process's own error boundary writes. A denial that
 * answered with only a sentence would give an agent or a CLI nothing to act
 * on, which is why the remediation fields ride along even though older clients
 * ignore them.
 */
function handledErrorResponseBody(error: HandledError): object {
  const { code, message, meta, tips, docsUrl, fault, retryable } = error;
  return {
    error: code,
    message,
    ...(meta ?? {}),
    ...(tips?.length ? { tips } : {}),
    ...(docsUrl ? { docsUrl } : {}),
    ...(fault ? { fault } : {}),
    retryable: retryable === true,
  };
}
