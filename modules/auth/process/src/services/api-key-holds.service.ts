import type { AuthzPermission, RestKeyDoorPrincipal } from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";

import type { ApiKeyPermissionReach } from "./api-rest-credentials.service.ts";

/** Whether a key door principal holds a permission at the reach the route asks. */
export class ApiKeyHoldsService {
  static create(peers: {
    authz: Pick<
      AuthzApi,
      | "hasApiKeyPermission"
      | "getApiKeyProjectDecision"
      | "hasProjectPermission"
      | "listApiKeyBindings"
    >;
  }): ApiKeyHoldsService {
    return new ApiKeyHoldsService(peers.authz);
  }

  private constructor(
    private readonly authz: Pick<
      AuthzApi,
      | "hasApiKeyPermission"
      | "getApiKeyProjectDecision"
      | "hasProjectPermission"
      | "listApiKeyBindings"
    >,
  ) {}

  /** A legacy project key holds everything by its class, as on the project door. */
  async holds(input: {
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
}
