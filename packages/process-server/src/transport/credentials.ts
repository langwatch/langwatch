import {
  OrganizationAuthenticationUnavailableError,
  OrganizationCredentialClassMismatchError,
  OrganizationInvalidCredentialsError,
  OrganizationMissingCredentialsError,
  OrganizationNotFoundForCredentialError,
  OrganizationPermissionError,
  ProjectInvalidCredentialsError,
  ProjectMissingCredentialsError,
} from "@langwatch/api";
// Resolves project and organization credentials. Reads peer Apps resolved
// by the same boot that mounts the routes.
import {
  ApiKeyPermissionDeniedError,
  ApiKeyPermissionNotDelegableError,
  type ApiKeyApi,
  type ResolvedApiKeyCredential,
  type ResolvedOrganizationApiKeyToken,
} from "@langwatch/api-key-contract";
import type { AuthzApi, AuthzPermission, PermissionDecision } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { classifyForLangy } from "@langwatch/langy-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import { OrganizationNotFoundError, type OrganizationApi } from "@langwatch/organization-contract";

export type ApiProjectCredential = Readonly<{
  project: ResolvedApiKeyCredential["project"];
  resolved: ResolvedApiKeyCredential;
  markUsed: () => void;
}>;

export type ApiOrganizationCredential = Readonly<{
  resolved: ResolvedOrganizationApiKeyToken;
  markUsed: () => void;
}>;

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

  async authenticate(input: {
    request: Request;
    permission: AuthzPermission;
  }): Promise<ApiProjectCredential> {
    const credentials = extractApiKeyRequestCredentials(input.request);
    if (!credentials) throw new ProjectMissingCredentialsError();

    const resolved = await this.apiKeys.findResolvedToken(credentials);
    if (!resolved) throw new ProjectInvalidCredentialsError();

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

  async identify(input: { request: Request }): Promise<ApiProjectCredential> {
    const credentials = extractApiKeyRequestCredentials(input.request);
    if (!credentials) throw new ProjectMissingCredentialsError();

    const resolved = await this.apiKeys.findResolvedToken(credentials);
    if (!resolved) throw new ProjectInvalidCredentialsError();

    return {
      project: resolved.project,
      resolved,
      markUsed: () => {
        if (resolved.type === "apiKey") this.apiKeys.markUsed({ id: resolved.apiKeyId });
      },
    };
  }

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
    if (!allowed) throw new OrganizationPermissionError(input.permission);

    return identified;
  }

  async identifyOrganization(input: { request: Request }): Promise<ApiOrganizationCredential> {
    const credentials = extractApiKeyRequestCredentials(input.request);
    if (!credentials) throw new OrganizationMissingCredentialsError();

    const resolved = await this.resolveOrganization(credentials.token);
    await this.assertOrganizationExists(resolved.organizationId);

    return {
      resolved,
      markUsed: () => this.apiKeys.markUsed({ id: resolved.apiKeyId }),
    };
  }

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

  private async resolveOrganization(token: string): Promise<ResolvedOrganizationApiKeyToken> {
    let resolution;
    try {
      resolution = await this.apiKeys.resolveOrganizationToken({ token });
    } catch (error) {
      this.logger.error({ error }, "Organization credential resolution failed");
      throw new OrganizationAuthenticationUnavailableError();
    }

    if (resolution.ok) return resolution.resolved;
    throw resolution.reason === "wrong_credential_class"
      ? new OrganizationCredentialClassMismatchError()
      : new OrganizationInvalidCredentialsError();
  }

  private async assertOrganizationExists(organizationId: string): Promise<void> {
    try {
      await this.organizations.getSettings({ organizationId });
    } catch (error) {
      if (error instanceof OrganizationNotFoundError) {
        throw new OrganizationNotFoundForCredentialError();
      }
      this.logger.error(
        { error, organizationId },
        "Organization lookup failed while authenticating an organization credential",
      );
      throw new OrganizationAuthenticationUnavailableError();
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

export function apiKeyCeilingRefusal(
  resolved: Extract<ResolvedApiKeyCredential, { type: "apiKey" }>,
  permission: AuthzPermission,
  logger: Pick<Logger, "error">,
): HandledError {
  logger.error(
    {
      apiKeyId: resolved.apiKeyId,
      userId: resolved.userId ?? null,
      projectId: resolved.project.id,
      permission,
    },
    "API key ceiling denial",
  );
  const langy = resolved.isLangySessionKey ? classifyForLangy(permission) : null;
  if (langy && langy.disposition !== "granted") {
    return new ApiKeyPermissionNotDelegableError(permission, { subject: "Langy" });
  }
  return new ApiKeyPermissionDeniedError(permission);
}

export type ApiKeyRequestCredentials = Readonly<{
  token: string;
  projectId: string | null;
}>;

export function extractApiKeyRequestCredentials(request: Request): ApiKeyRequestCredentials | null {
  const authorization = request.headers.get("authorization");
  const xAuthToken = request.headers.get("x-auth-token");
  const xProjectId = request.headers.get("x-project-id");

  if (authorization?.toLowerCase().startsWith("basic ")) {
    const parsed = parseBasicCredentials(authorization.slice(6));
    if (parsed) {
      return parsed;
    }
  }

  if (authorization?.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice(7).trim();
    if (token) {
      return { token, projectId: xProjectId };
    }
  }

  return xAuthToken ? { token: xAuthToken, projectId: xProjectId } : null;
}

function parseBasicCredentials(value: string): ApiKeyRequestCredentials | null {
  try {
    const decoded = Buffer.from(value, "base64").toString("utf-8");
    const separator = decoded.indexOf(":");
    if (separator < 1 || separator === decoded.length - 1) {
      return null;
    }
    return {
      projectId: decoded.slice(0, separator),
      token: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}
