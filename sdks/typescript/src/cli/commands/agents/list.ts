import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import {
  AgentsApiService,
  type AgentResponse,
} from "@/client-sdk/services/agents/agents-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { formatTable, formatRelativeTime } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/** Who a personal or host-scoped agent belongs to, empty for a shared one. */
export const agentOwnerLabel = (agent: AgentResponse): string =>
  agent.owner?.name ?? agent.hostLabel ?? "";

/** The status column: online or offline for a connected agent, empty for the other types. */
export const agentStatusLabel = (agent: AgentResponse): string => agent.status ?? "";

/**
 * Returns the listing rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts). The `table` closure
 * is the human form.
 *
 * @see specs/typescript-sdk/cli-agents.feature
 */
export const listAgentsCommand = async (): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new AgentsApiService();
  const spinner = createSpinner("Fetching agents...").start();

  try {
    const result = await service.list({ limit: 100 });
    const agents = result.data;

    spinner.succeed(
      `Found ${result.pagination.total} agent${result.pagination.total !== 1 ? "s" : ""}`,
    );

    return {
      data: result,
      table: () => {
        if (agents.length === 0) {
          console.log();
          console.log(chalk.gray("No agents found in this project."));
          console.log(chalk.gray("Connect one from code with connectAgent (langwatch/agent), or create an HTTP agent with:"));
          console.log(
            chalk.cyan(
              '  langwatch agent create "My Agent" --type http --config \'{"url":"https://..."}\'',
            ),
          );
          return;
        }

        console.log();

        const tableData = agents.map((agent) => ({
          Name: agent.name,
          Environment: agent.environment ?? "",
          Status: agentStatusLabel(agent),
          Type: agent.type,
          ID: agent.id,
          Owner: agentOwnerLabel(agent),
          Updated: formatRelativeTime(agent.updatedAt),
        }));

        formatTable({
          data: tableData,
          headers: ["Name", "Environment", "Status", "Type", "ID", "Owner", "Updated"],
          colorMap: {
            Name: chalk.cyan,
            ID: chalk.green,
            Type: chalk.yellow,
            Status: (value: string) =>
              value === "online" ? chalk.green(value) : value === "offline" ? chalk.gray(value) : value,
          },
        });

        console.log();
        console.log(
          chalk.gray(
            `Use ${chalk.cyan("langwatch agent get <id>")} to view agent details`,
          ),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch agents" });
    process.exit(1);
  }
};
