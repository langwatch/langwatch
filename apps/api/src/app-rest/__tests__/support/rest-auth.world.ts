/**
 * One tenant, seeded: an organization with a team, projects, people and the API keys they
 * carry — driving the process's REAL credential chain rather than the pass-through fakes in
 * `rest-family.harness`. The key resolves or it does not, the ceiling holds or it does not.
 */

/*
 * There is no database. The three services the chain composes over — API keys, authz and
 * organization settings — are the seam, and they are seeded from the world's own tables.
 */
import type {
  ApiKeyService,
  OrganizationApiKeyResolution,
  ResolvedApiKeyToken,
} from "@langwatch/api-key-contract";
import type { AppRestSecurity } from "@langwatch/api/rest";
import {
  builtinRoleGrants,
  permissionSatisfiedBy,
  type AuthzPermission,
  type AuthzService,
  type BuiltinRoleKey,
} from "@langwatch/authz-contract";
import {
  OrganizationNotFoundError,
  type OrganizationService,
} from "@langwatch/organization-contract";

import { ApiRestObservabilityComposition } from "../../../app/api-rest-observability.composition";
import { ApiRestSecurity } from "../../../api-rest.security";

/** A project the world serves, in the shape a resolved credential names it by. */
export type RestAuthProject = Readonly<{
  id: string;
  name: string;
  slug: string;
  teamId: string;
  organizationId: string;
  isPersonal: boolean;
  ownerUserId: string | null;
}>;

/**
 * One credential the world will resolve. `grants` is the key's ceiling: left out, the key
 * carries its holder's built-in role; given, it is exactly what the key may do however
 * senior its holder — which is what makes a read-only key testable against a write route.
 */
export type RestAuthKey = Readonly<{
  /** The bearer value a request sends. */
  token: string;
  /** Which family of route this credential is for. */
  kind?: "project" | "organization" | "legacyProject";
  /** Required for a project or legacy-project key. */
  projectId?: string;
  organizationId?: string;
  /** `null` is the distinct case of a key that names no person. */
  userId?: string | null;
  apiKeyId?: string;
  role?: BuiltinRoleKey;
  grants?: readonly string[];
}>;

export type RestAuthWorldOptions = Readonly<{
  projects?: readonly RestAuthProject[];
  keys?: readonly RestAuthKey[];
  /** Organizations that exist; defaults to every organization a project or key names. */
  organizations?: readonly string[];
}>;

export const REST_AUTH_ORGANIZATION = "organization-alpha";
export const REST_AUTH_TEAM = "team-alpha";
export const REST_AUTH_USER = "user-alpha";

/** The project every suite that names none is calling for. */
export const REST_AUTH_PROJECT: RestAuthProject = {
  id: "project-alpha",
  name: "Alpha",
  slug: "alpha",
  teamId: REST_AUTH_TEAM,
  organizationId: REST_AUTH_ORGANIZATION,
  isPersonal: false,
  ownerUserId: null,
};

/** The admin project key every suite that names no credential sends. */
export const REST_AUTH_ADMIN_KEY = "sk-lw-alpha-admin";

type ApiKeyRecord = Required<Pick<RestAuthKey, "token">> & {
  kind: "project" | "organization" | "legacyProject";
  projectId: string | null;
  organizationId: string;
  userId: string | null;
  apiKeyId: string;
  role: BuiltinRoleKey;
  grants: readonly string[] | null;
};

export class RestAuthWorld {
  private readonly projects: Map<string, RestAuthProject>;
  private readonly keys: Map<string, ApiKeyRecord>;
  private readonly organizations: Set<string>;
  /** Every key the chain stamped as used, so a suite can assert the stamp happened. */
  readonly used: string[] = [];

  private constructor(options: RestAuthWorldOptions) {
    const projects = options.projects ?? [REST_AUTH_PROJECT];
    this.projects = new Map(projects.map((project) => [project.id, project]));

    const keys = options.keys ?? [{ token: REST_AUTH_ADMIN_KEY, projectId: REST_AUTH_PROJECT.id }];
    this.keys = new Map(
      keys.map((key, index) => {
        const kind = key.kind ?? (key.projectId ? "project" : "organization");
        const project = key.projectId ? this.projects.get(key.projectId) : undefined;
        if (key.projectId && !project) {
          throw new Error(`Key ${key.token} names project ${key.projectId}, which is not seeded`);
        }
        const organizationId =
          key.organizationId ?? project?.organizationId ?? REST_AUTH_ORGANIZATION;
        return [
          key.token,
          {
            token: key.token,
            kind,
            projectId: key.projectId ?? null,
            organizationId,
            userId: key.userId === undefined ? REST_AUTH_USER : key.userId,
            apiKeyId: key.apiKeyId ?? `api-key-${index + 1}`,
            role: key.role ?? "admin",
            grants: key.grants ?? null,
          },
        ];
      }),
    );

    this.organizations = new Set(
      options.organizations ?? [
        ...projects.map((project) => project.organizationId),
        ...[...this.keys.values()].map((key) => key.organizationId),
      ],
    );
  }

  static create(options: RestAuthWorldOptions = {}): RestAuthWorld {
    return new RestAuthWorld(options);
  }

  /** The bearer header for a seeded token. */
  static bearer(token: string): Record<string, string> {
    return { authorization: `Bearer ${token}` };
  }

  /** The process's real REST enforcement, composed over this world. */
  security(): AppRestSecurity {
    return ApiRestSecurity.create({
      apiKeys: this.apiKeyService(),
      authz: this.authzService(),
      organizations: this.organizationService(),
      observability: ApiRestObservabilityComposition.create(),
      logger: { error: () => {} },
    });
  }

  /** Whether this key's ceiling admits the permission at all. */
  private permits(key: ApiKeyRecord, permission: string): boolean {
    return key.grants
      ? permissionSatisfiedBy({ granted: new Set(key.grants), requested: permission })
      : builtinRoleGrants({ role: key.role, permission });
  }

  private apiKeyService(): ApiKeyService {
    const keys = this.keys;
    const used = this.used;
    return {
      tryResolveToken: async ({
        token,
        projectId,
      }: {
        token: string;
        projectId?: string | null;
      }): Promise<ResolvedApiKeyToken | null> => {
        const key = keys.get(token);
        if (!key || key.kind === "organization" || !key.projectId) return null;
        // A re-pointing header selects a project only inside the key's own
        // organization; a cross-tenant id resolves to nothing at all, which is
        // why the caller is refused before any permission is consulted.
        const selected = projectId ?? key.projectId;
        if (!this.reaches(key, selected)) return null;
        const project = this.projects.get(selected)!;
        if (key.kind === "legacyProject") {
          return { type: "legacyProjectKey", project };
        }
        return {
          type: "apiKey",
          apiKeyId: key.apiKeyId,
          userId: key.userId,
          organizationId: key.organizationId,
          ingestSourceType: null,
          ingestionTemplateId: null,
          project,
        };
      },
      resolveOrganizationToken: async ({
        token,
      }: {
        token: string;
      }): Promise<OrganizationApiKeyResolution> => {
        const key = keys.get(token);
        if (!key) return { ok: false, reason: "unusable_credential" };
        if (key.kind !== "organization") return { ok: false, reason: "wrong_credential_class" };
        return {
          ok: true,
          resolved: {
            type: "apiKey-org",
            apiKeyId: key.apiKeyId,
            userId: key.userId,
            organizationId: key.organizationId,
          },
        };
      },
      markUsed: ({ id }: { id: string }) => {
        used.push(id);
      },
    } as unknown as ApiKeyService;
  }

  private authzService(): AuthzService {
    const byApiKeyId = new Map([...this.keys.values()].map((key) => [key.apiKeyId, key]));
    return {
      hasApiKeyPermission: async ({
        apiKeyId,
        organizationId,
        scope,
        permission,
      }: {
        apiKeyId: string;
        organizationId: string;
        scope: { type: string; id: string; teamId?: string };
        permission: AuthzPermission;
      }): Promise<boolean> => {
        const key = byApiKeyId.get(apiKeyId);
        if (!key || key.organizationId !== organizationId) return false;
        if (scope.type === "project" && !this.reaches(key, scope.id)) return false;
        return this.permits(key, permission);
      },
      getApiKeyProjectDecision: async ({
        apiKeyId,
        projectId,
        permission,
      }: {
        apiKeyId: string;
        projectId: string;
        permission: AuthzPermission;
      }): Promise<{ outcome: "allowed" | "denied" | "project_not_found" }> => {
        const key = byApiKeyId.get(apiKeyId);
        if (!key || !this.reaches(key, projectId)) return { outcome: "project_not_found" };
        return { outcome: this.permits(key, permission) ? "allowed" : "denied" };
      },
    } as unknown as AuthzService;
  }

  /** A key reaches a project only inside its own organization — the tenant boundary. */
  private reaches(key: ApiKeyRecord, projectId: string): boolean {
    const project = this.projects.get(projectId);
    return Boolean(project && project.organizationId === key.organizationId);
  }

  private organizationService(): OrganizationService {
    const organizations = this.organizations;
    return {
      getSettings: async ({ organizationId }: { organizationId: string }) => {
        if (!organizations.has(organizationId)) {
          throw new OrganizationNotFoundError();
        }
        return { id: organizationId, name: "Alpha" };
      },
    } as unknown as OrganizationService;
  }
}
