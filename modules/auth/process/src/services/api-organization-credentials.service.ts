import {
  OrganizationAuthenticationUnavailableError,
  OrganizationCredentialClassMismatchError,
  OrganizationInvalidCredentialsError,
  OrganizationMissingCredentialsError,
  OrganizationNotFoundForCredentialError,
  OrganizationPermissionError,
} from "@langwatch/api";
import type { ApiKeyApi, ResolvedOrganizationApiKeyToken } from "@langwatch/api-key-contract";
import type { AuthzPermission, PermissionDecision } from "@langwatch/authorization";
import { AuthzScopeNotFoundError, type AuthzApi } from "@langwatch/authz-contract";
import type { Logger } from "@langwatch/observability";
import {
  OrganizationNotFoundError,
  TeamNotFoundError,
  type OrganizationApi,
} from "@langwatch/organization-contract";

import { asked, extractApiKeyRequestCredentials } from "../rules/api-credential-request.rules.ts";

export type ApiOrganizationCredential = Readonly<{
  resolved: ResolvedOrganizationApiKeyToken;
  markUsed: () => void;
}>;

/** Organization-class API keys at the API door: who they are and what they may reach. */
export class ApiOrganizationCredentialsService {
  static create(peers: {
    apiKeys: Pick<ApiKeyApi, "resolveOrganizationToken" | "markUsed">;
    authz: Pick<AuthzApi, "hasApiKeyPermission" | "getApiKeyProjectDecision" | "getScope">;
    organizations: Pick<OrganizationApi, "getSettings">;
    logger: Pick<Logger, "error">;
  }): ApiOrganizationCredentialsService {
    return new ApiOrganizationCredentialsService(peers);
  }

  private constructor(
    private readonly peers: {
      apiKeys: Pick<ApiKeyApi, "resolveOrganizationToken" | "markUsed">;
      authz: Pick<AuthzApi, "hasApiKeyPermission" | "getApiKeyProjectDecision" | "getScope">;
      organizations: Pick<OrganizationApi, "getSettings">;
      logger: Pick<Logger, "error">;
    },
  ) {}

  async authenticateOrganization(input: {
    request: Request;
    permissions: readonly AuthzPermission[];
  }): Promise<ApiOrganizationCredential> {
    const identified = await this.identifyOrganization({ request: input.request });
    const resolved = identified.resolved;
    for (const permission of asked(input.permissions)) {
      const allowed = await this.peers.authz.hasApiKeyPermission({
        apiKeyId: resolved.apiKeyId,
        userId: resolved.userId,
        organizationId: resolved.organizationId,
        scope: { type: "org", id: resolved.organizationId },
        permission,
      });
      if (!allowed) throw new OrganizationPermissionError(permission);
    }

    return identified;
  }

  async identifyOrganization(input: { request: Request }): Promise<ApiOrganizationCredential> {
    const credentials = extractApiKeyRequestCredentials(input.request);
    if (!credentials) throw new OrganizationMissingCredentialsError();

    const resolved = await this.resolveOrganization(credentials.token);
    await this.assertOrganizationExists(resolved.organizationId);

    return {
      resolved,
      markUsed: () => this.peers.apiKeys.markUsed({ id: resolved.apiKeyId }),
    };
  }

  async authorizeOrganizationRoute(input: {
    credential: ResolvedOrganizationApiKeyToken;
    permission: AuthzPermission;
    projectId: string;
  }): Promise<PermissionDecision> {
    const decision = await this.peers.authz.getApiKeyProjectDecision({
      apiKeyId: input.credential.apiKeyId,
      userId: input.credential.userId,
      organizationId: input.credential.organizationId,
      projectId: input.projectId,
      permission: input.permission,
    });

    // No `denialReason`: this door answers from the KEY's grants, and none of
    // the five reasons the vocabulary names is the one that decided a project
    // the key may not reach.
    return { permitted: decision.outcome === "allowed", organizationRole: null };
  }

  /**
   * A route-scoped permission at a team (finding H4). The team's organization is read from the
   * team, never taken from the key; a team outside the key's organization answers as missing.
   */
  async authorizeOrganizationTeamRoute(input: {
    credential: ResolvedOrganizationApiKeyToken;
    permission: AuthzPermission;
    teamId: string;
  }): Promise<PermissionDecision> {
    const { apiKeyId, userId, organizationId } = input.credential;
    if (!(await this.isTeamOf({ teamId: input.teamId, organizationId }))) {
      throw new TeamNotFoundError(input.teamId);
    }
    const permitted = await this.peers.authz.hasApiKeyPermission({
      apiKeyId,
      userId,
      organizationId,
      scope: { type: "team", id: input.teamId },
      permission: input.permission,
    });

    return { permitted, organizationRole: null };
  }

  private async isTeamOf(input: { teamId: string; organizationId: string }): Promise<boolean> {
    try {
      const scope = await this.peers.authz.getScope({ teamId: input.teamId });

      return scope.type === "team" && scope.organizationId === input.organizationId;
    } catch (error) {
      if (AuthzScopeNotFoundError.is(error)) return false;
      throw error;
    }
  }

  private async resolveOrganization(token: string): Promise<ResolvedOrganizationApiKeyToken> {
    let resolution;
    try {
      resolution = await this.peers.apiKeys.resolveOrganizationToken({ token });
    } catch (error) {
      this.peers.logger.error({ error }, "Organization credential resolution failed");
      throw new OrganizationAuthenticationUnavailableError();
    }

    if (resolution.ok) return resolution.resolved;
    throw resolution.reason === "wrong_credential_class"
      ? new OrganizationCredentialClassMismatchError()
      : new OrganizationInvalidCredentialsError();
  }

  private async assertOrganizationExists(organizationId: string): Promise<void> {
    try {
      await this.peers.organizations.getSettings({ organizationId });
    } catch (error) {
      if (error instanceof OrganizationNotFoundError) {
        throw new OrganizationNotFoundForCredentialError();
      }
      this.peers.logger.error(
        { error, organizationId },
        "Organization lookup failed while authenticating an organization credential",
      );
      throw new OrganizationAuthenticationUnavailableError();
    }
  }
}
