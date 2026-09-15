import { AgentRegisterRefusedError } from "@langwatch/agent-contract";
import {
  LANGY_SESSION_API_KEY_NAME,
  type ApiKeyApi,
  type ResolvedApiKeyCredential,
} from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ProjectApi } from "@langwatch/project-contract";
export interface ResolvedConnectCredential {
  project: { id: string; slug: string };
  userId: string | null;
  principalId: string;
}

export interface ConnectedAgentCredentials {
  resolve(input: { token: string; projectId: string | null }): Promise<ResolvedConnectCredential>;
}

type ConnectedAgentCredentialDependencies = {
  apiKeys: ApiKeyApi;
  authz: AuthzApi;
  projects: ProjectApi;
};

export class ConnectedAgentCredentialService implements ConnectedAgentCredentials {
  readonly #apiKeys: ApiKeyApi;
  readonly #authz: AuthzApi;
  readonly #projects: ProjectApi;

  static create(dependencies: ConnectedAgentCredentialDependencies) {
    return new ConnectedAgentCredentialService(dependencies);
  }

  private constructor(dependencies: ConnectedAgentCredentialDependencies) {
    this.#apiKeys = dependencies.apiKeys;
    this.#authz = dependencies.authz;
    this.#projects = dependencies.projects;
  }

  async resolve(input: {
    token: string;
    projectId: string | null;
  }): Promise<ResolvedConnectCredential> {
    const resolved = await this.#apiKeys.findResolvedToken(input);
    if (!resolved) {
      throw await this.#refusalForMiss(input);
    }

    if (resolved.type === "apiKey") {
      this.#assertAllowedKeyKind(resolved.ingestionTemplateId, resolved.isLangySessionKey === true);
      const allowed = await this.#canConnect(resolved);
      if (!allowed) {
        throw new AgentRegisterRefusedError({
          reason: "permission_denied",
          message: "The API key needs the scenarios:manage permission to connect an agent.",
        });
      }
    }

    return {
      project: { id: resolved.project.id, slug: resolved.project.slug },
      userId: resolved.type === "apiKey" ? resolved.userId : null,
      principalId: this.#principalId(resolved),
    };
  }

  async #refusalForMiss(input: { token: string; projectId: string | null }) {
    if (!input.projectId) {
      const key = await this.#apiKeys.findVerifiedToken({ token: input.token });
      if (key) {
        this.#assertAllowedKeyKind(
          key.ingestionTemplateId,
          key.name === LANGY_SESSION_API_KEY_NAME,
        );
        const projects = await this.#projects.listByOrganization({
          organizationId: key.organizationId,
          page: 1,
          limit: 50,
        });
        const reachable = await Promise.all(
          projects.data.map(async (project) => {
            const resolved = await this.#apiKeys.findResolvedToken({
              token: input.token,
              projectId: project.id,
            });
            if (!resolved || !(await this.#canConnect(resolved))) {
              return null;
            }

            return { id: project.id, name: project.name };
          }),
        );
        return new AgentRegisterRefusedError({
          reason: "project_required",
          message:
            "This API key reaches several projects. Send the project id in the X-Project-Id header.",
          meta: { projects: reachable.filter((project) => project !== null) },
        });
      }
    }

    return new AgentRegisterRefusedError({
      reason: "api_key_invalid",
      message: "The API key is not valid for this project.",
    });
  }

  #principalId(resolved: ResolvedApiKeyCredential): string {
    if (resolved.type === "legacyProjectKey") {
      return `legacy-project:${resolved.project.id}`;
    }

    return resolved.userId === null ? `key:${resolved.apiKeyId}` : `user:${resolved.userId}`;
  }

  async #canConnect(resolved: ResolvedApiKeyCredential): Promise<boolean> {
    if (resolved.type === "legacyProjectKey") {
      return true;
    }

    return this.#authz.hasApiKeyPermission({
      apiKeyId: resolved.apiKeyId,
      userId: resolved.userId,
      organizationId: resolved.organizationId,
      scope: { type: "project", id: resolved.project.id, teamId: resolved.project.teamId },
      permission: "scenarios:manage",
    });
  }

  #assertAllowedKeyKind(ingestionTemplateId: string | null, isLangySessionKey: boolean): void {
    if (ingestionTemplateId !== null || isLangySessionKey) {
      throw new AgentRegisterRefusedError({
        reason: "key_type_not_allowed",
        message:
          "An ingestion key or a Langy session key cannot connect an agent. Use a personal or a project API key.",
      });
    }
  }
}
