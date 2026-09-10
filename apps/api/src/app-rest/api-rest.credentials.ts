/**
 * The two credentials this process resolves for itself: the project door every
 * SDK key arrives at, and the organization door the management surfaces answer
 * behind.
 *
 * It reads three peer Apps and nothing else. Every one of them is another
 * module resolved by the same boot that mounts the routes, which is why the
 * process states its doors as a factory rather than building them beforehand.
 */
import {
  type ApiKeyApi,
  type ResolvedApiKeyCredential,
  type ResolvedOrganizationApiKeyToken,
} from "@langwatch/api-key-contract";
import type { AuthzApi, AuthzPermission, PermissionDecision } from "@langwatch/authz-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import { OrganizationNotFoundError, type OrganizationApi } from "@langwatch/organization-contract";

import { apiKeyCeilingRefusal } from "../app/api-key-ceiling-refusal.ts";
import { extractApiKeyRequestCredentials } from "../app/api-key-request-credentials.ts";
import {
  ApiProjectInvalidCredentialsError,
  ApiProjectMissingCredentialsError,
  ApiOrganizationAuthenticationUnavailableError,
  ApiOrganizationCredentialClassMismatchError,
  ApiOrganizationInvalidCredentialsError,
  ApiOrganizationMissingCredentialsError,
  ApiOrganizationNotFoundForCredentialError,
  ApiOrganizationPermissionError,
  INVALID_PROJECT_CREDENTIAL_MESSAGE,
  MISSING_PROJECT_CREDENTIAL_MESSAGE,
} from "./api-rest.refusals.ts";

/**
 * What a resolved project credential gives a door.
 *
 * There is no refused shape: a door that will not accept a credential throws
 * the `HandledError` naming why, and the REST boundary renders it. A result
 * object here would carry a status and a body the boundary never sees, so the
 * caller would receive a message with no `code` to branch on.
 */
export type ApiProjectCredential = Readonly<{
  project: ResolvedApiKeyCredential["project"];
  resolved: ResolvedApiKeyCredential;
  markUsed: () => void;
}>;

/** The same, for the organization door, which names no project. */
export type ApiOrganizationCredential = Readonly<{
  resolved: ResolvedOrganizationApiKeyToken;
  markUsed: () => void;
}>;

/** The peer Apps the two credential chains read. */
export type ApiRestCredentialPeers = Readonly<{
  apiKeys: ApiKeyApi;
  authz: Pick<AuthzApi, "hasApiKeyPermission" | "getApiKeyProjectDecision">;
  organizations: Pick<OrganizationApi, "getSettings">;
  logger?: Pick<Logger, "error">;
}>;

export class ApiRestCredentials {
  static create(peers: ApiRestCredentialPeers): ApiRestCredentials {
    return new ApiRestCredentials(
      peers.apiKeys,
      peers.authz,
      peers.organizations,
      peers.logger ?? createLogger("langwatch:api:rest:credential"),
    );
  }

  private constructor(
    private readonly apiKeys: ApiKeyApi,
    private readonly authz: ApiRestCredentialPeers["authz"],
    private readonly organizations: ApiRestCredentialPeers["organizations"],
    private readonly logger: Pick<Logger, "error">,
  ) {}

  /**
   * Resolve the request's project credential and enforce one permission as an
   * API-key ceiling.
   */
  async authenticate(input: {
    request: Request;
    permission: AuthzPermission;
  }): Promise<ApiProjectCredential> {
    const credentials = extractApiKeyRequestCredentials(input.request);
    if (!credentials) throw new ApiProjectMissingCredentialsError();

    const resolved = await this.apiKeys.findResolvedToken(credentials);
    if (!resolved) throw new ApiProjectInvalidCredentialsError();

    if (resolved.type === "apiKey") {
      const allowed = await this.isWithinCeiling({ resolved, permission: input.permission });
      if (!allowed) throw apiKeyCeilingRefusal(resolved, input.permission, this.logger);
    }

    return {
      project: resolved.project,
      resolved,
      markUsed: () => {
        if (resolved.type === "apiKey") this.apiKeys.markUsed({ id: resolved.apiKeyId });
      },
    };
  }

  /**
   * The same project credential, resolved and asked NOTHING. A route that
   * answers any authenticated caller has no permission for the door to enforce
   * as the key's ceiling.
   */
  async identify(input: { request: Request }): Promise<ApiProjectCredential> {
    const credentials = extractApiKeyRequestCredentials(input.request);
    if (!credentials) throw new ApiProjectMissingCredentialsError();

    const resolved = await this.apiKeys.findResolvedToken(credentials);
    if (!resolved) throw new ApiProjectInvalidCredentialsError();

    return {
      project: resolved.project,
      resolved,
      markUsed: () => {
        if (resolved.type === "apiKey") this.apiKeys.markUsed({ id: resolved.apiKeyId });
      },
    };
  }

  /**
   * Resolve the request's ORGANIZATION credential and enforce one permission at
   * organization scope. A project key presented here is told so by name rather
   * than refused as invalid: the two are different mistakes to make.
   */
  async authenticateOrganization(input: {
    request: Request;
    permission: AuthzPermission;
  }): Promise<ApiOrganizationCredential> {
    const identified = await this.identifyOrganization(input);
    const resolved = identified.resolved;
    const allowed = await this.authz.hasApiKeyPermission({
      apiKeyId: resolved.apiKeyId,
      userId: resolved.userId,
      organizationId: resolved.organizationId,
      scope: { type: "org", id: resolved.organizationId },
      permission: input.permission,
    });
    if (!allowed) throw new ApiOrganizationPermissionError(input.permission);

    return identified;
  }

  /**
   * The same credential, resolved and asked NOTHING. A family whose routes
   * answer any authenticated caller has no permission for the door to ask at
   * the organization.
   */
  async identifyOrganization(input: { request: Request }): Promise<ApiOrganizationCredential> {
    const credentials = extractApiKeyRequestCredentials(input.request);
    if (!credentials) throw new ApiOrganizationMissingCredentialsError();

    const resolved = await this.resolveOrganization(credentials.token);
    await this.assertOrganizationExists(resolved.organizationId);

    return {
      resolved,
      markUsed: () => this.apiKeys.markUsed({ id: resolved.apiKeyId }),
    };
  }

  /**
   * Whether the resolved credential holds one permission at the PROJECT a
   * route's own path named. The project is checked against the credential's
   * organization, so a key cannot reach across tenants by naming an id.
   */
  async authorizeOrganizationRoute(input: {
    credential: ResolvedOrganizationApiKeyToken;
    permission: AuthzPermission;
    projectId: string;
  }): Promise<PermissionDecision> {
    const decision = await this.authz.getApiKeyProjectDecision({
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

  /** The organization credential the token stands for, or the refusal it earns. */
  private async resolveOrganization(token: string): Promise<ResolvedOrganizationApiKeyToken> {
    let resolution;
    try {
      resolution = await this.apiKeys.resolveOrganizationToken({ token });
    } catch (error) {
      this.logger.error({ error }, "Organization credential resolution failed");
      throw new ApiOrganizationAuthenticationUnavailableError();
    }

    if (resolution.ok) return resolution.resolved;
    throw resolution.reason === "wrong_credential_class"
      ? new ApiOrganizationCredentialClassMismatchError()
      : new ApiOrganizationInvalidCredentialsError();
  }

  /**
   * A deleted organization is an expected refusal and stays quiet; any other
   * failure is the lookup itself breaking, and the answer the caller receives
   * carries none of the cause, so it is logged here or lost.
   */
  private async assertOrganizationExists(organizationId: string): Promise<void> {
    try {
      await this.organizations.getSettings({ organizationId });
    } catch (error) {
      if (error instanceof OrganizationNotFoundError) {
        throw new ApiOrganizationNotFoundForCredentialError();
      }
      this.logger.error(
        { error, organizationId },
        "Organization lookup failed while authenticating an organization credential",
      );
      throw new ApiOrganizationAuthenticationUnavailableError();
    }
  }

  private isWithinCeiling(input: {
    resolved: Extract<ResolvedApiKeyCredential, { type: "apiKey" }>;
    permission: AuthzPermission;
  }): Promise<boolean> {
    const { resolved, permission } = input;
    return this.authz.hasApiKeyPermission({
      apiKeyId: resolved.apiKeyId,
      userId: resolved.userId ?? null,
      organizationId: resolved.organizationId,
      scope: { type: "project", id: resolved.project.id, teamId: resolved.project.teamId },
      permission,
    });
  }
}

