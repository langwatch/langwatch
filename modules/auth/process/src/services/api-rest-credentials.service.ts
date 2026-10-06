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
import { assertKeyKind, keyCredentialOf, type RestKeyKind } from "@langwatch/api/rest";
import {
  PermissionDeniedError,
  type AuthzPermission,
  type PermissionDecision,
  type RestKeyDoorPrincipal,
  type RestProjectIdentity,
  type RestResolvedProjectCredential,
} from "@langwatch/authorization";
import { AuthzScopeNotFoundError, type AuthzApi } from "@langwatch/authz-contract";
import type { HandledError } from "@langwatch/handled-error";
import { classifyForLangy } from "@langwatch/langy-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import {
  OrganizationNotFoundError,
  TeamNotFoundError,
  type OrganizationApi,
} from "@langwatch/organization-contract";

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
  principal: RestKeyDoorPrincipal;
  organizationId: string;
  markUsed: () => void;
}>;

/** How far the key door asks a permission of a key; absent, its project, else its organization. */
export type ApiKeyPermissionReach = "grants" | "organization";

export type ApiRestCredentialPeers = Readonly<{
  apiKeys: Pick<ApiKeyApi, "findResolvedToken" | "resolveOrganizationToken" | "markUsed">;
  authz: Pick<
    AuthzApi,
    | "hasApiKeyPermission"
    | "getApiKeyProjectDecision"
    | "hasProjectPermission"
    | "listApiKeyBindings"
    | "getScope"
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

  /** Every permission the route asks, in order, after one resolve; the first missing refuses. */
  async authenticate(input: {
    request: Request;
    permissions: readonly AuthzPermission[];
    /** The key kinds the route admits (E7): refused once the key resolves, before permission. */
    keyKinds?: readonly RestKeyKind[];
  }): Promise<ApiProjectCredential> {
    const credential = await this.identify({ request: input.request });
    if (input.keyKinds) {
      assertKeyKind({ key: keyCredentialOf(credential.resolved), admitted: input.keyKinds });
    }

    for (const permission of asked(input.permissions)) {
      if (!(await this.#projectHolds({ credential, permission }))) {
        throw this.#projectRefusal({ credential, permission });
      }
    }

    return credential;
  }

  /** A route-scoped permission (E3), asked only at the project the credential resolved. */
  async authorizeProjectRoute(input: {
    credential: ApiProjectCredential;
    permission: AuthzPermission;
    projectId: string;
  }): Promise<PermissionDecision> {
    const { credential, permission, projectId } = input;
    if (projectId !== credential.project.id) return { permitted: false, organizationRole: null };

    return {
      permitted: await this.#projectHolds({ credential, permission }),
      organizationRole: null,
    };
  }

  /** A person is asked their own access, a key its ceiling; a legacy key holds all by its class. */
  #projectHolds(input: {
    credential: ApiProjectCredential;
    permission: AuthzPermission;
  }): Promise<boolean> {
    const { credential, permission } = input;
    if (credential.actsAsPerson) {
      return this.authz.hasProjectPermission({
        userId: credential.actsAsPerson.userId,
        projectId: credential.project.id,
        permission,
      });
    }
    const { resolved } = credential;
    if (resolved.type !== "apiKey") return Promise.resolve(true);

    return this.isWithinCeiling({ resolved, permission });
  }

  #projectRefusal(input: {
    credential: ApiProjectCredential;
    permission: AuthzPermission;
  }): HandledError {
    const { credential, permission } = input;
    if (!credential.actsAsPerson && credential.resolved.type === "apiKey") {
      return apiKeyCeilingRefusal(credential.resolved, permission, this.logger);
    }

    return new ApiKeyPermissionDeniedError(permission);
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
   * through its organization. A project-bound access token is its person in that project.
   */
  async identifyKey(input: { request: Request }): Promise<ApiKeyDoorCredential> {
    const person = await this.#cliAccessCredential(input.request);
    if (person) {
      return {
        principal: {
          kind: "cliAccessToken",
          userId: person.actsAsPerson.userId,
          organizationId: person.project.organizationId,
          projectId: person.project.id,
          teamId: person.project.teamId,
        },
        organizationId: person.project.organizationId,
        markUsed: person.markUsed,
      };
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

  /**
   * Any API key, asked the route's permission at its own reach: the project it acts in, else its
   * organization. `grants` lets a key that names no project pass on any scope it is granted at;
   * `organization` asks at the whole organization, whatever project the key named.
   */
  async authenticateKey(input: {
    request: Request;
    permissions: readonly AuthzPermission[];
    reach?: ApiKeyPermissionReach;
  }): Promise<ApiKeyDoorCredential> {
    const { reach } = input;
    const credential = await this.identifyKey({ request: input.request });
    for (const permission of asked(input.permissions)) {
      const allowed = await this.#keyHolds({ principal: credential.principal, permission, reach });
      if (!allowed)
        throw keyPermissionRefusal({ credential, permission, ...(reach ? { reach } : {}) });
    }

    return credential;
  }

  /** A legacy project key holds everything by its class, as on the project door. */
  async #keyHolds(input: {
    principal: RestKeyDoorPrincipal;
    permission: AuthzPermission;
    reach: ApiKeyPermissionReach | undefined;
  }): Promise<boolean> {
    const { principal, permission, reach } = input;
    if (principal.kind === "project") return true;
    if (principal.kind === "cliAccessToken") {
      // The token is its person inside one project, so it holds nothing organization-wide.
      if (reach === "organization") return false;

      return this.authz.hasProjectPermission({
        userId: principal.userId,
        projectId: principal.projectId,
        permission,
      });
    }

    const key = {
      apiKeyId: principal.apiKeyId,
      userId: principal.userId,
      organizationId: principal.organizationId,
      permission,
    };
    const project = principal.resolvedProject;
    if (reach !== "organization" && project) {
      return this.authz.hasApiKeyPermission({ ...key, scope: { type: "project", ...project } });
    }
    if (reach !== "grants") {
      return this.authz.hasApiKeyPermission({
        ...key,
        scope: { type: "org", id: principal.organizationId },
      });
    }

    return this.#heldOnAnyGrant(key);
  }

  /** A key holds what its grants give, so asking at each granted scope covers its whole reach. */
  async #heldOnAnyGrant(key: {
    apiKeyId: string;
    userId: string | null;
    organizationId: string;
    permission: AuthzPermission;
  }): Promise<boolean> {
    const grants = await this.authz.listApiKeyBindings({
      organizationId: key.organizationId,
      apiKeyIds: [key.apiKeyId],
    });
    const answers = await Promise.all(
      grants.map(async ({ scopeType, scopeId }) => {
        if (scopeType === "PROJECT") {
          const decision = await this.authz.getApiKeyProjectDecision({
            ...key,
            projectId: scopeId,
          });

          return decision.outcome === "allowed";
        }

        return this.authz.hasApiKeyPermission({
          ...key,
          scope:
            scopeType === "TEAM" ? { type: "team", id: scopeId } : { type: "org", id: scopeId },
        });
      }),
    );

    return answers.some(Boolean);
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
    permissions: readonly AuthzPermission[];
  }): Promise<ApiOrganizationCredential> {
    const identified = await this.identifyOrganization({ request: input.request });
    const resolved = identified.resolved;
    for (const permission of asked(input.permissions)) {
      const allowed = await this.authz.hasApiKeyPermission({
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
    const permitted = await this.authz.hasApiKeyPermission({
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
      const scope = await this.authz.getScope({ teamId: input.teamId });

      return scope.type === "team" && scope.organizationId === input.organizationId;
    } catch (error) {
      if (AuthzScopeNotFoundError.is(error)) return false;
      throw error;
    }
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

/** A door asked no permission is a mis-wired route: refused, never admitted. */
function asked(permissions: readonly AuthzPermission[]): readonly AuthzPermission[] {
  if (permissions.length === 0) throw new Error("A credential door was asked no permission");

  return permissions;
}

/** The one denial every tier answers with, at the scope the key was asked at. */
function keyPermissionRefusal(input: {
  credential: ApiKeyDoorCredential;
  permission: AuthzPermission;
  reach?: ApiKeyPermissionReach;
}): PermissionDeniedError {
  const { principal, organizationId } = input.credential;
  const projectId =
    principal.kind === "apiKey" ? principal.resolvedProject?.id : principal.projectId;

  return new PermissionDeniedError({
    permission: input.permission,
    scope:
      input.reach !== "organization" && projectId
        ? { type: "project", id: projectId }
        : { type: "organization", id: organizationId },
    denialReason: "no-binding",
  });
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

  if (!xAuthToken && authorization?.toLowerCase().startsWith("basic ")) {
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
