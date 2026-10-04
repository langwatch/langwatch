import {
  OrganizationAuthenticationUnavailableError,
  OrganizationCredentialClassMismatchError,
  OrganizationInvalidCredentialsError,
  OrganizationMissingCredentialsError,
  OrganizationNotFoundForCredentialError,
  OrganizationPermissionError,
  ProjectInvalidCredentialsError,
  ProjectMissingCredentialsError,
  ProjectRequiredError,
} from "@langwatch/api";
import {
  ApiKeyPermissionDeniedError,
  ApiKeyPermissionNotDelegableError,
  type ApiKeyApi,
  type ResolvedOrganizationApiKeyToken,
} from "@langwatch/api-key-contract";
import type {
  AuthzPermission,
  PermissionDecision,
  RestKeyCredentialPrincipal,
  RestProjectIdentity,
  RestResolvedProjectCredential,
} from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { HandledError } from "@langwatch/handled-error";
import { classifyForLangy } from "@langwatch/langy-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import { OrganizationNotFoundError, type OrganizationApi } from "@langwatch/organization-contract";

import { CliDeviceSessionService } from "./cli-device-session.service.ts";

export type ApiProjectCredential = Readonly<{
  project: RestProjectIdentity;
  resolved: RestResolvedProjectCredential;
  markUsed: () => void;
  /** Set when a person's project-bound CLI access token stands behind it, not an API key. */
  actsAsPerson?: Readonly<{ userId: string }>;
}>;

/** The person and live project a project-bound CLI access bearer names. */
export type CliAccessProject = Readonly<{
  userId: string;
  organizationId: string;
  project: RestProjectIdentity;
}>;

export type ApiOrganizationCredential = Readonly<{
  resolved: ResolvedOrganizationApiKeyToken;
  markUsed: () => void;
}>;

export type ApiKeyDoorCredential = Readonly<{
  principal: RestKeyCredentialPrincipal;
  organizationId: string;
  markUsed: () => void;
}>;

export type ApiRestCredentialPeers = Readonly<{
  apiKeys: Pick<ApiKeyApi, "findResolvedToken" | "resolveOrganizationToken" | "markUsed">;
  authz: Pick<
    AuthzApi,
    "hasApiKeyPermission" | "getApiKeyProjectDecision" | "hasProjectPermission"
  >;
  /** Reads the person and project behind a CLI access bearer; refuses one bound to none. */
  cliProjects: Readonly<{
    getCliAccessProject: (input: { authorization: string }) => Promise<CliAccessProject>;
  }>;
  organizations: Pick<OrganizationApi, "getSettings">;
  logger?: Pick<Logger, "error">;
}>;

/** Resolves project and organization API-key credentials for the API door (record §8). */
export class ApiRestCredentialsService {
  static create(peers: ApiRestCredentialPeers): ApiRestCredentialsService {
    return new ApiRestCredentialsService({
      ...peers,
      logger: peers.logger ?? createLogger("langwatch:api:rest:credential"),
    });
  }

  private readonly apiKeys: ApiRestCredentialPeers["apiKeys"];
  private readonly authz: ApiRestCredentialPeers["authz"];
  private readonly organizations: ApiRestCredentialPeers["organizations"];
  private readonly cliProjects: ApiRestCredentialPeers["cliProjects"];
  private readonly logger: Pick<Logger, "error">;

  private constructor(peers: Required<ApiRestCredentialPeers>) {
    this.apiKeys = peers.apiKeys;
    this.authz = peers.authz;
    this.organizations = peers.organizations;
    this.cliProjects = peers.cliProjects;
    this.logger = peers.logger;
  }

  async authenticate(input: {
    request: Request;
    permission: AuthzPermission;
  }): Promise<ApiProjectCredential> {
    const person = await this.#cliAccessCredential(input.request);
    if (person) {
      const allowed = await this.authz.hasProjectPermission({
        userId: person.actsAsPerson.userId,
        projectId: person.project.id,
        permission: input.permission,
      });
      if (!allowed) throw new ApiKeyPermissionDeniedError(input.permission);

      return person;
    }

    const credentials = extractApiKeyRequestCredentials(input.request);
    if (!credentials) throw new ProjectMissingCredentialsError();

    const resolved = await this.apiKeys.findResolvedToken(credentials);
    if (!resolved) throw await this.unresolvedProjectRefusal(credentials);

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
    const person = await this.#cliAccessCredential(input.request);
    if (person) return person;

    const credentials = extractApiKeyRequestCredentials(input.request);
    if (!credentials) throw new ProjectMissingCredentialsError();

    const resolved = await this.apiKeys.findResolvedToken(credentials);
    if (!resolved) throw await this.unresolvedProjectRefusal(credentials);

    return {
      project: resolved.project,
      resolved,
      markUsed: () => {
        if (resolved.type === "apiKey") this.apiKeys.markUsed({ id: resolved.apiKeyId });
      },
    };
  }

  /**
   * Any API key, with no project demanded (#8085): a legacy key IS its project, a key that
   * resolves a project still reaches its organization, and one naming no project resolves
   * through its organization. Only a token that is neither is refused.
   */
  async identifyKey(input: { request: Request }): Promise<ApiKeyDoorCredential> {
    const person = await this.#cliAccessCredential(input.request);
    if (person) {
      throw new ProjectInvalidCredentialsError();
    }

    const credentials = extractApiKeyRequestCredentials(input.request);
    if (!credentials) throw new ProjectMissingCredentialsError();

    const resolved = await this.apiKeys.findResolvedToken(credentials);
    if (resolved?.type === "legacyProjectKey") {
      return {
        principal: { kind: "project", projectId: resolved.project.id },
        organizationId: resolved.project.organizationId,
        markUsed: () => {},
      };
    }
    if (resolved) {
      return {
        principal: {
          kind: "apiKey",
          apiKeyId: resolved.apiKeyId,
          userId: resolved.userId,
          organizationId: resolved.organizationId,
          resolvedProject: { id: resolved.project.id, teamId: resolved.project.teamId },
        },
        organizationId: resolved.organizationId,
        markUsed: () => this.apiKeys.markUsed({ id: resolved.apiKeyId }),
      };
    }

    const organization = await this.apiKeys.resolveOrganizationToken({ token: credentials.token });
    if (!organization.ok) throw new ProjectInvalidCredentialsError();
    const { apiKeyId, userId, organizationId } = organization.resolved;

    return {
      principal: { kind: "apiKey", apiKeyId, userId, organizationId },
      organizationId,
      markUsed: () => this.apiKeys.markUsed({ id: apiKeyId }),
    };
  }

  /** A project-bound access token (`lw_at_`, header or bearer) as its person. */
  async #cliAccessCredential(
    request: Request,
  ): Promise<(ApiProjectCredential & Readonly<{ actsAsPerson: { userId: string } }>) | null> {
    const xAuthToken = request.headers.get("x-auth-token")?.trim();
    const presented = xAuthToken?.startsWith("lw_at_")
      ? `Bearer ${xAuthToken}`
      : request.headers.get("authorization");
    const token = CliDeviceSessionService.extractBearerCliAccessToken(presented);
    if (!token) return null;

    const held = await this.cliProjects.getCliAccessProject({ authorization: `Bearer ${token}` });

    return {
      project: held.project,
      resolved: {
        type: "cliAccessToken",
        userId: held.userId,
        organizationId: held.organizationId,
        project: held.project,
      },
      markUsed: () => {},
      actsAsPerson: { userId: held.userId },
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

  /**
   * Why a token resolved to no project. A live key that named none is told to name one. A named
   * project the key cannot reach stays an unknown credential, so a key learns nothing about
   * projects outside its grants.
   */
  private async unresolvedProjectRefusal(
    credentials: ApiKeyRequestCredentials,
  ): Promise<HandledError> {
    if (credentials.projectId) return new ProjectInvalidCredentialsError();

    const key = await this.apiKeys.resolveOrganizationToken({ token: credentials.token });

    return key.ok ? new ProjectRequiredError() : new ProjectInvalidCredentialsError();
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
    resolved: Extract<RestResolvedProjectCredential, { type: "apiKey" }>;
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

function apiKeyCeilingRefusal(
  resolved: Extract<RestResolvedProjectCredential, { type: "apiKey" }>,
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

type ApiKeyRequestCredentials = Readonly<{
  token: string;
  projectId: string | null;
}>;

function extractApiKeyRequestCredentials(request: Request): ApiKeyRequestCredentials | null {
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
