import chalk from "chalk";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import { buildRequestHeaders } from "@/internal/api/request-headers";
import { scopedApiKey } from "@/internal/credentialContext";
import { langwatchFetch } from "@/internal/http/langwatchFetch";

import { resolveCredentials } from "../../utils/apiKey.ts";
import { failSpinnerFromResponse } from "../../utils/failFromResponse.ts";
import type { CommandResult } from "../../utils/output.ts";
import { createSpinner } from "../../utils/spinner.ts";

export const runTopicClusteringCommand = async (): Promise<CommandResult | void> => {
  await resolveCredentials();
  const spinner = createSpinner("Starting topic clustering...").start();
  const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  const response = await langwatchFetch(`${resolveControlPlaneUrl()}/api/v1/topics/clustering/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...buildRequestHeaders({ apiKey }) },
    body: "{}",
  });
  if (!response.ok) {
    await failSpinnerFromResponse({ spinner, response, action: "start topic clustering" });
    process.exit(1);
  }
  const result = (await response.json()) as
    | { started: true }
    | { started: false; reason: "already_running" };
  spinner.succeed(
    result.started ? "Topic clustering started" : "Topic clustering is already running",
  );
  return {
    data: result,
    table: () =>
      console.log(
        result.started ? chalk.green("Topic clustering started.") : "Topic clustering is already running.",
      ),
  };
};
