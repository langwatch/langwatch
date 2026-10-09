import {
  ProjectInvalidCredentialsError,
  ProjectMissingCredentialsError,
  ProjectRequiredError,
} from "@langwatch/api";
import {
  ApiKeyPermissionDeniedError,
  ApiKeyPermissionNotDelegableError,
  type ApiKeyApi,
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
import type { AuthzApi } from "@langwatch/authz-contract";
import type { HandledError } from "@langwatch/handled-error";
import { classifyForLangy } from "@langwatch/langy-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import { type OrganizationApi } from "@langwatch/organization-contract";

import {
  asked,
  extractApiKeyRequestCredentials,
  type ApiKeyRequestCredentials,
} from "../rules/api-credential-request.rules.ts";
import { ApiKeyHoldsService } from "./api-key-holds.service.ts";
import {
  ApiOrganizationCredentialsService,
  type ApiOrganizationCredential,
} from "./api-organization-credentials.service.ts";
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

export type { ApiOrganizationCredential };

export type ApiKeyDoorCredential = Readonly<{
  principal: RestKeyDoorPrincipal;
  organizationId: string;
  markUsed: () => void;
}>;

/** How many organization projects a `project_required` refusal looks through (main's 50). */
const REACHABLE_PROJECTS_LISTED = 50;

/** How far the key door asks a permission of a key; absent, its project, else its organization. */
export type ApiKeyPermissionReach = "grants" | "organization";

export type ApiRestCredentialPeers = Readonly<{
  apiKeys: Pick<
    ApiKeyApi,
    "findResolvedToken" | "resolveOrganizationToken" | "markUsed" | "getOrgProjects"
  >;
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
  private readonly keyHolds: ApiKeyHoldsService;
  private readonly organizationCredentials: ApiOrganizationCredentialsService;

  private constructor(peers: Required<ApiRestCredentialPeers>) {
    this.keyHolds = ApiKeyHoldsService.create({ authz: peers.authz });
    this.organizationCredentials = ApiOrganizationCredentialsService.create(peers);
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
    const credential = await this.identify({
      request: input.request,
      permissions: input.permissions,
    });
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

  async identify(input: {
    request: Request;
    /** What the route asks, so a key naming no project is told the ones it may name. */
    permissions?: readonly AuthzPermission[];
  }): Promise<ApiProjectCredential> {
    const person = await this.#cliAccessCredential(input.request);
    if (person) return person;

    const credentials = extractApiKeyRequestCredentials(input.request);
    if (!credentials) throw new ProjectMissingCredentialsError();

    const resolved = await this.apiKeys.findResolvedToken(credentials);
    if (!resolved) {
      throw await this.unresolvedProjectRefusal({
        credentials,
        permissions: input.permissions ?? [],
      });
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
      const allowed = await this.keyHolds.holds({
        principal: credential.principal,
        permission,
        reach,
      });
      if (!allowed)
        throw keyPermissionRefusal({ credential, permission, ...(reach ? { reach } : {}) });
    }

    return credential;
  }

  authenticateOrganization(
    input: Parameters<ApiOrganizationCredentialsService["authenticateOrganization"]>[0],
  ): Promise<ApiOrganizationCredential> {
    return this.organizationCredentials.authenticateOrganization(input);
  }

  identifyOrganization(
    input: Parameters<ApiOrganizationCredentialsService["identifyOrganization"]>[0],
  ): Promise<ApiOrganizationCredential> {
    return this.organizationCredentials.identifyOrganization(input);
  }

  authorizeOrganizationRoute(
    input: Parameters<ApiOrganizationCredentialsService["authorizeOrganizationRoute"]>[0],
  ): Promise<PermissionDecision> {
    return this.organizationCredentials.authorizeOrganizationRoute(input);
  }

  authorizeOrganizationTeamRoute(
    input: Parameters<ApiOrganizationCredentialsService["authorizeOrganizationTeamRoute"]>[0],
  ): Promise<PermissionDecision> {
    return this.organizationCredentials.authorizeOrganizationTeamRoute(input);
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

  /**
   * Why a token resolved to no project. A live key that named none is told to name one. A named
   * project the key cannot reach stays an unknown credential, so a key learns nothing about
   * projects outside its grants.
   */
  private async unresolvedProjectRefusal(input: {
    credentials: ApiKeyRequestCredentials;
    permissions: readonly AuthzPermission[];
  }): Promise<HandledError> {
    const { credentials, permissions } = input;
    if (credentials.projectId) return new ProjectInvalidCredentialsError();

    const key = await this.apiKeys.resolveOrganizationToken({ token: credentials.token });
    if (!key.ok) return new ProjectInvalidCredentialsError();

    return new ProjectRequiredError({
      projects: await this.findReachableProjects({
        token: credentials.token,
        organizationId: key.resolved.organizationId,
        permissions,
      }),
    });
  }

  /** The key's projects that hold every asked permission, among the organization's first fifty. */
  private async findReachableProjects(input: {
    token: string;
    organizationId: string;
    permissions: readonly AuthzPermission[];
  }): Promise<{ id: string; name: string }[]> {
    const projects = await this.apiKeys.getOrgProjects({ organizationId: input.organizationId });
    const reachable = await Promise.all(
      projects.slice(0, REACHABLE_PROJECTS_LISTED).map(async (project) => {
        const resolved = await this.apiKeys.findResolvedToken({
          token: input.token,
          projectId: project.id,
        });
        if (!resolved) return [];
        const credential: ApiProjectCredential = {
          project: resolved.project,
          resolved,
          markUsed: () => {},
        };
        for (const permission of input.permissions) {
          if (!(await this.#projectHolds({ credential, permission }))) return [];
        }
        return [{ id: project.id, name: project.name }];
      }),
    );

    return reachable.flat();
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
