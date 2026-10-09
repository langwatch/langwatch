import type { ApiKeyApi } from "@langwatch/api-key-contract";
import { createLogger } from "@langwatch/observability";

import { ExperimentSandboxCredential } from "./experiment-run-sandbox-key.service.ts";

const logger = createLogger("langwatch:experiment:run-sandbox-credential");

/**
 * The key a run lends the code it executes: the one its project's code agent runs share, holding
 * only the agent cache (specs/agent-cache/agent-cache.feature). A run that cannot get one still
 * runs, without the agent cache.
 */
export class ExperimentRunSandboxCredentialService extends ExperimentSandboxCredential {
  static create({
    apiKeys,
  }: {
    apiKeys: Pick<ApiKeyApi, "mintAgentSandboxKey">;
  }): ExperimentRunSandboxCredentialService {
    return new ExperimentRunSandboxCredentialService(apiKeys);
  }

  private constructor(private readonly apiKeys: Pick<ApiKeyApi, "mintAgentSandboxKey">) {
    super();
  }

  async findRunKey({
    projectId,
  }: {
    projectId: string;
    userId: string | null;
  }): Promise<string | undefined> {
    try {
      return await this.apiKeys.mintAgentSandboxKey({ projectId });
    } catch (error) {
      logger.warn(
        { projectId, error },
        "could not get an agent sandbox key; the run continues without the agent cache",
      );

      return undefined;
    }
  }
}
