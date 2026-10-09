import { RunPlansApiService } from "@/client-sdk/services/run-plans";
import { createLangWatchApiClient } from "@/internal/api/client";
import {
  CLI_SURFACE_HEADER,
  CLI_SURFACE_VALUE,
} from "../../utils/governance/surface";

/**
 * The run plan API service for CLI commands. It declares the CLI surface on
 * every request, so a plan created or run from the command line is recorded
 * with the command line as its author.
 *
 * @see specs/features/run-plan-cli.feature
 */
export function createCliRunPlansService(): RunPlansApiService {
  const apiClient = createLangWatchApiClient();
  apiClient.use({
    onRequest({ request }) {
      request.headers.set(CLI_SURFACE_HEADER, CLI_SURFACE_VALUE);
      return request;
    },
  });
  return new RunPlansApiService({ langwatchApiClient: apiClient });
}
