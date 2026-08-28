import {
  ApiKeyPermissionDeniedError,
  ApiKeyPermissionNotDelegableError,
  type ApiKeyService,
  type ResolvedApiKeyToken,
} from "@langwatch/api-key-contract";
import type { AuthzPermission, AuthzService } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { classifyForLangy } from "@langwatch/langy-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import {
  ApiRestSecurityPort,
  type ApiRestAuthenticatedRequest,
  type ApiRestSuccessfulResponse,
} from "../api-rest.security";
import type { ApiAuditPort } from "../api-request.policy";
import { extractApiKeyRequestCredentials } from "./api-key-request-credentials";

/** The published credential refusal for the standalone REST process. */
export class ApiRestAuthenticationError extends HandledError {
  declare readonly code: "missing_credentials" | "invalid_credentials";

  constructor(code: "missing_credentials" | "invalid_credentials") {
    super(
      code,
      code === "missing_credentials" ? "Authentication required" : "Invalid credentials",
      {
        httpStatus: 401,
        fault: "customer",
      },
    );
    this.name = "ApiRestAuthenticationError";
  }
}

/**
 * API-process adapter for the established project-key transport semantics.
 *
 * The policy invokes `complete` only after a successful response, keeping
 * mark-used and request audit effects out of failed requests.
 */
export class ApiKeyRestSecurityAdapter extends ApiRestSecurityPort {
  static create(options: {
    apiKeys: ApiKeyService;
    authz: AuthzService;
    audit?: ApiAuditPort;
    logger?: Pick<Logger, "error">;
  }): ApiKeyRestSecurityAdapter {
    return new ApiKeyRestSecurityAdapter(
      options.apiKeys,
      options.authz,
      options.audit,
      options.logger ?? createLogger("langwatch:api:rest-security"),
    );
  }

  private constructor(
    private readonly apiKeys: ApiKeyService,
    private readonly authz: AuthzService,
    private readonly audit: ApiAuditPort | undefined,
    private readonly logger: Pick<Logger, "error">,
  ) {
    super();
  }

  async authenticate(request: Request): Promise<ApiRestAuthenticatedRequest> {
    const credentials = extractApiKeyRequestCredentials(request);
    if (!credentials) {
      throw new ApiRestAuthenticationError("missing_credentials");
    }

    const resolved = await this.apiKeys.tryResolveToken(credentials);
    if (!resolved) {
      throw new ApiRestAuthenticationError("invalid_credentials");
    }

    return authenticatedRequest(resolved);
  }

  async authorize(input: {
    request: ApiRestAuthenticatedRequest;
    permission: AuthzPermission;
  }): Promise<void> {
    if (!isCurrentApiKeyRequest(input.request)) {
      return;
    }

    const allowed = await this.authz.hasApiKeyPermission({
      apiKeyId: input.request.apiKeyId,
      userId: input.request.actor?.id ?? null,
      organizationId: input.request.organizationId,
      scope: {
        type: "project",
        id: input.request.projectId,
        teamId: input.request.teamId,
      },
      permission: input.permission,
    });
    if (!allowed) {
      refuseApiKeyCeiling(input.request, input.permission);
    }
  }

  async complete(input: ApiRestSuccessfulResponse): Promise<void> {
    if (!isCurrentApiKeyRequest(input.request)) {
      return;
    }

    this.apiKeys.markUsed({ id: input.request.apiKeyId });
    if (!isMutation(input.method) || !input.request.actor) {
      return;
    }

    try {
      await this.audit?.record({
        actorId: input.request.actor.id,
        path: input.path,
        input: {
          method: input.method,
          projectId: input.request.projectId,
          status: input.status,
        },
        error: null,
      });
    } catch (error) {
      this.logger.error(
        { error, method: input.method, path: input.path, projectId: input.request.projectId },
        "REST request audit failed after a successful response",
      );
    }
  }
}

type CurrentApiKeyRequest = ApiRestAuthenticatedRequest &
  Readonly<{
    apiKeyId: string;
    organizationId: string;
    teamId: string;
    isLangySessionKey: boolean;
  }>;

function authenticatedRequest(
  resolved: ResolvedApiKeyToken,
): ApiRestAuthenticatedRequest | CurrentApiKeyRequest {
  const base = {
    projectId: resolved.project.id,
    actor: resolved.type === "apiKey" && resolved.userId ? { id: resolved.userId } : null,
  };
  if (resolved.type === "legacyProjectKey") {
    return base;
  }

  return {
    ...base,
    apiKeyId: resolved.apiKeyId,
    organizationId: resolved.organizationId,
    teamId: resolved.project.team.id,
    isLangySessionKey: resolved.isLangySessionKey ?? false,
  };
}

function isCurrentApiKeyRequest(
  request: ApiRestAuthenticatedRequest,
): request is CurrentApiKeyRequest {
  return "apiKeyId" in request;
}

function refuseApiKeyCeiling(request: CurrentApiKeyRequest, permission: AuthzPermission): never {
  const meta = {
    apiKeyId: request.apiKeyId,
    userId: request.actor?.id ?? null,
    projectId: request.projectId,
  };
  const langy = request.isLangySessionKey ? classifyForLangy(permission) : null;
  if (langy && langy.disposition !== "granted") {
    throw new ApiKeyPermissionNotDelegableError(permission, { subject: "Langy", meta });
  }
  throw new ApiKeyPermissionDeniedError(permission, { meta });
}

function isMutation(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}
