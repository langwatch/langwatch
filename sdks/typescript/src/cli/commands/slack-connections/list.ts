import chalk from "chalk";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import { buildAuthHeaders } from "@/internal/api/auth";
import { scopedApiKey } from "@/internal/credentialContext";
import { langwatchFetch } from "@/internal/http/langwatchFetch";

import { resolveCredentials } from "../../utils/apiKey.ts";
import { failSpinnerFromResponse } from "../../utils/failFromResponse.ts";
import { formatTable } from "../../utils/formatting.ts";
import type { CommandResult } from "../../utils/output.ts";
import { createSpinner } from "../../utils/spinner.ts";
import { failSpinner } from "../../utils/spinnerError.ts";

interface SlackConnection {
  id: string;
  name: string;
  kind: "bot" | "webhook";
  scopeType: "ORGANIZATION" | "PROJECT";
  scopeName: string;
  slackTeamName: string | null;
}

/** Lists the Slack connections an automation can post through, so one can be
 *  named by id in `slackIntegrationId`. The API never returns their secrets. */
export const listSlackConnectionsCommand = async (): Promise<CommandResult | void> => {
  await resolveCredentials();

  const spinner = createSpinner("Fetching Slack connections...").start();

  try {
    const response = await langwatchFetch(`${resolveControlPlaneUrl()}/api/v1/slack-connections`, {
      signal: AbortSignal.timeout(30_000),
      headers: buildAuthHeaders({ apiKey: scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "" }),
    });

    if (!response.ok) {
      await failSpinnerFromResponse({ spinner, response, action: "fetch Slack connections" });
      process.exit(1);
    }

    const connections: SlackConnection[] = await response.json();

    spinner.succeed(
      `Found ${connections.length} Slack connection${connections.length !== 1 ? "s" : ""}`,
    );

    return {
      data: connections,
      table: () => {
        console.log();
        if (connections.length === 0) {
          console.log(chalk.gray("No Slack connections found."));
          console.log(chalk.gray("Add one under Settings, Integrations, Slack."));
          return;
        }

        formatTable({
          data: connections.map((connection) => ({
            Name: connection.name,
            ID: connection.id,
            Kind: connection.kind,
            Scope: `${connection.scopeType.toLowerCase()}: ${connection.scopeName}`,
            Workspace: connection.slackTeamName ?? "-",
          })),
          headers: ["Name", "ID", "Kind", "Scope", "Workspace"],
          colorMap: { Name: chalk.cyan, ID: chalk.green },
        });

        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch Slack connections" });
    process.exit(1);
  }
};
