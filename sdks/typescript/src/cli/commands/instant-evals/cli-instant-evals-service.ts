import { InstantEvalsApiService } from "@/client-sdk/services/instant-evals";
import { createLangWatchApiClient } from "@/internal/api/client";

import { CLI_SURFACE_HEADER, CLI_SURFACE_VALUE } from "../../utils/governance/surface";

/**
 * The Instant Evals API service for CLI commands, declaring the CLI surface on every request so a
 * run is recorded with the command line as its author.
 * @see specs/features/instant-eval-cli.feature
 */
export function createCliInstantEvalsService(): InstantEvalsApiService {
  const apiClient = createLangWatchApiClient();
  apiClient.use({
    onRequest({ request }) {
      request.headers.set(CLI_SURFACE_HEADER, CLI_SURFACE_VALUE);
      return request;
    },
  });
  return new InstantEvalsApiService({ langwatchApiClient: apiClient });
}
