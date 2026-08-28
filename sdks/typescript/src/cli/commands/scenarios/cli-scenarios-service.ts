import { ScenariosApiService } from "@/client-sdk/services/scenarios";
import { createLangWatchApiClient } from "@/internal/api/client";
import {
  CLI_SURFACE_HEADER,
  CLI_SURFACE_VALUE,
} from "../../utils/governance/surface";

/**
 * The scenarios API service for CLI commands. It declares the CLI surface on
 * every request, so a scenario save made from the command line is recorded
 * with the command line as its author in the case's version history.
 *
 * @see specs/scenarios/scenario-versioning.feature
 */
export function createCliScenariosService(): ScenariosApiService {
  const apiClient = createLangWatchApiClient();
  apiClient.use({
    onRequest({ request }) {
      request.headers.set(CLI_SURFACE_HEADER, CLI_SURFACE_VALUE);
      return request;
    },
  });
  return new ScenariosApiService({ langwatchApiClient: apiClient });
}
