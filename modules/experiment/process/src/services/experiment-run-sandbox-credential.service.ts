import { AGENT_SANDBOX_PERMISSIONS, type ApiKeyApi } from "@langwatch/api-key-contract";
import { createLogger } from "@langwatch/observability";

import { ExperimentSandboxCredential } from "./experiment-run-sandbox-key.service.ts";

const logger = createLogger("langwatch:experiment:run-sandbox-credential");

/**
 * The engine key's dispatch floor (workflow-run-key.rules.ts): a Lambda invocation's 900 s plus
 * a minute back. It is the longer of the two floors, so a self-hosted engine's 15 minutes is
 * covered too; this module cannot see which engine runs the cell.
 */
const SANDBOX_KEY_FLOOR_MS = 900 * 1000 + 60 * 1000;

/**
 * The key a run lends the code it executes: a per-run key for its starter (or the system)
 * holding only the agent cache. A run that cannot get one still runs, without the agent cache.
 */
export class ExperimentRunSandboxCredentialService extends ExperimentSandboxCredential {
  static create({
    apiKeys,
  }: {
    apiKeys: Pick<ApiKeyApi, "mintRunKey">;
  }): ExperimentRunSandboxCredentialService {
    return new ExperimentRunSandboxCredentialService(apiKeys);
  }

  private constructor(private readonly apiKeys: Pick<ApiKeyApi, "mintRunKey">) {
    super();
  }

  async findRunKey({
    projectId,
    userId,
  }: {
    projectId: string;
    userId: string | null;
  }): Promise<string | undefined> {
    try {
      return await this.apiKeys.mintRunKey({
        userId,
        projectId,
        permissions: [...AGENT_SANDBOX_PERMISSIONS],
        minRemainingMs: SANDBOX_KEY_FLOOR_MS,
      });
    } catch (error) {
      logger.warn(
        { projectId, error },
        "could not get an agent sandbox key; the run continues without the agent cache",
      );

      return undefined;
    }
  }
}
