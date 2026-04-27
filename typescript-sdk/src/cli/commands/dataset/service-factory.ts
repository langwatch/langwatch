import { DatasetService } from "@/client-sdk/services/datasets";
import { createLangWatchApiClient } from "@/internal/api/client";
import { NoOpLogger } from "@/logger";
import { DEFAULT_ENDPOINT } from "@/internal/constants";

/**
 * Creates a DatasetService configured from environment variables.
 * Reused by all dataset CLI commands.
 */
export function createDatasetService(): DatasetService {
  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = (
    process.env.LANGWATCH_ENDPOINT ?? DEFAULT_ENDPOINT
  ).replace(/\/$/, "");

  return new DatasetService({
    langwatchApiClient: createLangWatchApiClient(apiKey, endpoint),
    logger: new NoOpLogger(),
    endpoint,
    apiKey,
  });
}
