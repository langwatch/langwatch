import { ProjectInvalidCredentialsError, ProjectMissingCredentialsError } from "@langwatch/api";
/** Legacy trace API credential resolution. Strict error ordering: present,
 * resolves, then permission ceiling. */
import type { ApiKeyApi, ResolvedApiKeyCredential } from "@langwatch/api-key-contract";
import { ApiKeyPermissionDeniedError } from "@langwatch/api-key-contract";
import { credentialPrincipalOfToken } from "@langwatch/api/rest";
import type { AuthzApi, AuthzPermission } from "@langwatch/authz-contract";
import type { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";

import { extractTraceLegacyRequestCredentials } from "../rules/trace-request-credentials.rules.ts";
import type { TraceLegacyCredential } from "../transport/trace-legacy.rest.ts";

/** The two peers this door reads, and nothing else. */
export type TraceLegacyCredentialOptions = Readonly<{
  /** Narrowed to what this door calls: it resolves a token and stamps its clock. */
  apiKeys: Pick<ApiKeyApi, "findResolvedToken" | "markUsed">;
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

  #apiKeys: Pick<ApiKeyApi, "findResolvedToken" | "markUsed">;
  #authz: Pick<AuthzApi, "hasApiKeyPermission">;
  #logger: Pick<Logger, "error">;

  private constructor(
    apiKeys: Pick<ApiKeyApi, "findResolvedToken" | "markUsed">,
    authz: Pick<AuthzApi, "hasApiKeyPermission">,
    logger: Pick<Logger, "error">,
  ) {
    this.#apiKeys = apiKeys;
    this.#authz = authz;
    this.#logger = logger;
  }

  /**
   * Resolves the request's project credential and enforces one permission as
   * the API key's ceiling, throwing the refusal; the family renders it itself.
   */
  async resolve(input: {
    request: Request;
    permission: "traces:view" | "traces:share";
  }): Promise<TraceLegacyCredential> {
    const credentials = extractTraceLegacyRequestCredentials(input.request);
    if (!credentials) throw new ProjectMissingCredentialsError();

    const resolved = await this.#apiKeys.findResolvedToken(credentials);
    if (!resolved) throw new ProjectInvalidCredentialsError();

    // A legacy project key has no per-permission ceiling: project keys predate
    // RBAC and carry full project access by design.
    if (resolved.type === "apiKey") {
      const allowed = await this.#withinCeiling(resolved, input.permission);
      if (!allowed) throw this.#ceilingRefusal(resolved, input.permission);
    }

    return {
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
