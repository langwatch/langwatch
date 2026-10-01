import type { ApiKeyApi } from "@langwatch/api-key-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";

import { ExperimentSandboxCredential } from "./experiment-run-sandbox-key.service.ts";

const logger = createLogger("langwatch:experiment:run-sandbox-credential");

/**
 * The key a run lends the code it executes: the project's organization, then the shared or
 * freshly minted sandbox key. A run that cannot get one still runs, without the agent cache.
 */
export class ExperimentRunSandboxCredentialService extends ExperimentSandboxCredential {
  static create({
    projects,
    apiKeys,
  }: {
    projects: Pick<ProjectApi, "findOrganizationId">;
    apiKeys: Pick<ApiKeyApi, "getOrMintAgentSandboxKey">;
  }): ExperimentRunSandboxCredentialService {
    return new ExperimentRunSandboxCredentialService(projects, apiKeys);
  }

  private constructor(
    private readonly projects: Pick<ProjectApi, "findOrganizationId">,
    private readonly apiKeys: Pick<ApiKeyApi, "getOrMintAgentSandboxKey">,
  ) {
    super();
  }

  async findRunKey({ projectId }: { projectId: string }): Promise<string | undefined> {
    const organizationId = await this.projects.findOrganizationId(projectId);
    if (!organizationId) return undefined;

    try {
      return await this.apiKeys.getOrMintAgentSandboxKey({ projectId, organizationId });
    } catch (error) {
      logger.warn(
        { projectId, error },
        "could not get an agent sandbox key; the run continues without the agent cache",
      );

      return undefined;
    }
  }
}
