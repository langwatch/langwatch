/**
 * ADR-128's credential check for the WebSocket gateway and the HTTP long-poll
 * transport, over this process's own API-key and AuthZ services.
 *
 * Main's `AgentSessionCore.authenticate` (session.core.ts) inlined
 * `TokenResolver` and `enforceApiKeyCeiling`, both of which live in
 * `@langwatch/api-key-*`, which `agent-server` may not depend on. This
 * adapter folds its four steps — resolve the token, refuse an ingestion or
 * Langy session key, enforce `scenarios:manage`, and name the reachable
 * projects of an org-scoped key that named none — into the one call
 * `ConnectCredentialPort.resolve` makes, throwing `AgentRegisterRefusedError`
 * for every refusal so the session service never has to know why.
 */
import { AgentRegisterRefusedError } from "@langwatch/agent-contract";
import { ConnectCredentialPort, type ResolvedConnectCredential } from "@langwatch/agent-server";
import type { ApiKeyService, ResolvedApiKeyToken } from "@langwatch/api-key-contract";
import { HandledError } from "@langwatch/handled-error";

import type { ApiHandlerManagedCredentials } from "../../app/api-handler-managed-credential";

export class ApiConnectCredentialAdapter extends ConnectCredentialPort {
  static create(options: {
    apiKeys: ApiKeyService;
    credentials: ApiHandlerManagedCredentials;
    /** Named for the `project_required` refusal's `meta.projects`. */
    projectsReachableBy: (organizationId: string) => Promise<{ id: string; name: string }[]>;
  }): ApiConnectCredentialAdapter {
    return new ApiConnectCredentialAdapter(
      options.apiKeys,
      options.credentials,
      options.projectsReachableBy,
    );
  }

  private constructor(
    private readonly apiKeys: ApiKeyService,
    private readonly credentials: ApiHandlerManagedCredentials,
    private readonly projectsReachableBy: (
      organizationId: string,
    ) => Promise<{ id: string; name: string }[]>,
  ) {
    super();
  }

  async resolve({
    token,
    projectId,
  }: {
    token: string;
    projectId: string | null;
  }): Promise<ResolvedConnectCredential> {
    if (!token) {
      throw new AgentRegisterRefusedError({
        reason: "api_key_invalid",
        message: "Send the API key as Authorization: Bearer <key>.",
      });
    }

    const resolved = await this.apiKeys.tryResolveToken({ token, projectId });
    if (!resolved) {
      throw await this.refusalForMiss({ token, projectId });
    }
    this.assertKeyKindMayConnect(resolved);
    await this.assertKeyMayManageScenarios(resolved);

    return {
      project: { id: resolved.project.id, slug: resolved.project.slug },
      userId: resolved.type === "apiKey" ? resolved.userId : null,
    };
  }

  /**
   * A key that reaches several projects and named none is told which ones,
   * so the SDK can print them; everything else is an invalid key.
   */
  private async refusalForMiss({
    token,
    projectId,
  }: {
    token: string;
    projectId: string | null;
  }): Promise<AgentRegisterRefusedError> {
    if (!projectId) {
      const org = await this.apiKeys.resolveOrganizationToken({ token });
      if (org.ok) {
        const projects = await this.projectsReachableBy(org.resolved.organizationId);
        return new AgentRegisterRefusedError({
          reason: "project_required",
          message:
            "This API key reaches several projects. Send the project id in the X-Project-Id header.",
          meta: { projects },
        });
      }
    }
    return new AgentRegisterRefusedError({
      reason: "api_key_invalid",
      message: "The API key is not valid for this project.",
    });
  }

  /** An ingestion key or a Langy session key never connects an agent. */
  private assertKeyKindMayConnect(resolved: ResolvedApiKeyToken): void {
    if (resolved.type !== "apiKey") return;
    if (resolved.ingestionTemplateId !== null || resolved.isLangySessionKey) {
      throw new AgentRegisterRefusedError({
        reason: "key_type_not_allowed",
        message:
          "An ingestion key or a Langy session key cannot connect an agent. Use a personal or a project API key.",
      });
    }
  }

  private async assertKeyMayManageScenarios(resolved: ResolvedApiKeyToken): Promise<void> {
    try {
      await this.credentials.enforceCeiling({ resolved, permission: "scenarios:manage" });
    } catch (error) {
      if (!HandledError.isHandled(error)) throw error;
      throw new AgentRegisterRefusedError({
        reason: "permission_denied",
        message: "The API key needs the scenarios:manage permission to connect an agent.",
      });
    }
  }
}
