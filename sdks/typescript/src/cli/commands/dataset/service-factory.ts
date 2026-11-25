import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import { DatasetService } from "@/client-sdk/services/datasets";
import { createLangWatchApiClient } from "@/internal/api/client";
import { scopedApiKey } from "@/internal/credentialContext";
import { NoOpLogger } from "@/logger";
/**
 * Creates a DatasetService configured from environment variables.
 * Reused by all dataset CLI commands.
 */
export function createDatasetService(): DatasetService {
  const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl().replace(/\/$/, "");

  return new DatasetService({
    langwatchApiClient: createLangWatchApiClient(apiKey, endpoint),
    logger: new NoOpLogger(),
    endpoint,
    apiKey,
  });
}
