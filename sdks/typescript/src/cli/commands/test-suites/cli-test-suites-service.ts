import { TestSuitesApiService } from "@/client-sdk/services/test-suites";
import { createLangWatchApiClient } from "@/internal/api/client";
import { CLI_SURFACE_HEADER, CLI_SURFACE_VALUE } from "../../utils/governance/surface";

/**
 * The test suite API service for CLI commands. It declares the CLI surface on
 * every request, so a suite written or run from the command line is recorded
 * with the command line as its author.
 *
 * @see specs/features/test-suite-cli.feature
 */
export function createCliTestSuitesService(): TestSuitesApiService {
  const apiClient = createLangWatchApiClient();
  apiClient.use({
    onRequest({ request }) {
      request.headers.set(CLI_SURFACE_HEADER, CLI_SURFACE_VALUE);
      return request;
    },
  });
  return new TestSuitesApiService({ langwatchApiClient: apiClient });
}
