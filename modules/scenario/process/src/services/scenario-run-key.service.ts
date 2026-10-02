import { AGENT_SANDBOX_PERMISSIONS, type ApiKeyApi } from "@langwatch/api-key-contract";
import { CHILD_PROCESS, type TargetAdapterData } from "@langwatch/scenario-contract";

import { scenarioRunKeyPermissions } from "../rules/scenario-run-key.rules.ts";

type RunKeyRequest = {
  projectId: string;
  startedByUserId?: string | undefined;
  /** The API key the starter used: the run's key holds no more than it either. */
  startedByApiKeyId?: string | undefined;
};

/**
 * The keys a scenario run's child calls LangWatch with, minted by api-key's one run-key mint:
 * the starter's (refused before the run when they lack what the target needs) or the system's.
 * Each must outlive the child, which is stopped at `CHILD_PROCESS.TIMEOUT_MS`.
 */
export class ScenarioRunKeyService {
  static create(options: { apiKeys: Pick<ApiKeyApi, "mintRunKey"> }): ScenarioRunKeyService {
    return new ScenarioRunKeyService(options.apiKeys);
  }

  private constructor(private readonly apiKeys: Pick<ApiKeyApi, "mintRunKey">) {}

  /** The key the child's engine and telemetry use: only what the target needs. */
  tokenFor(input: RunKeyRequest & { adapter: TargetAdapterData }): Promise<string> {
    return this.mint(input, [
      ...scenarioRunKeyPermissions({
        targetType: input.adapter.type,
        workflowNodes: input.adapter.type === "workflow" ? input.adapter.workflow.nodes : [],
      }),
    ]);
  }

  /** The key a code agent's sandbox holds: the agent cache alone, since user code reads it. */
  sandboxTokenFor(input: RunKeyRequest): Promise<string> {
    return this.mint(input, [...AGENT_SANDBOX_PERMISSIONS]);
  }

  private mint(input: RunKeyRequest, permissions: string[]): Promise<string> {
    return this.apiKeys.mintRunKey({
      userId: input.startedByUserId ?? null,
      ...(input.startedByApiKeyId ? { callerApiKeyId: input.startedByApiKeyId } : {}),
      projectId: input.projectId,
      permissions,
      minRemainingMs: CHILD_PROCESS.TIMEOUT_MS,
    });
  }
}
