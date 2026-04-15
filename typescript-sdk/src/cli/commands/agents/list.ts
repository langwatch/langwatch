import chalk from "chalk";
import ora from "ora";
import {
  AgentsApiService,
  AgentsApiError,
} from "@/client-sdk/services/agents/agents-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable, formatRelativeTime } from "../../utils/formatting";

export const listAgentsCommand = async (options?: { format?: string }): Promise<void> => {
  checkApiKey();

  const service = new AgentsApiService();
  const spinner = ora("Fetching agents...").start();

  try {
    const result = await service.list({ limit: 100 });
    const agents = result.data;

    spinner.succeed(
      `Found ${result.pagination.total} agent${result.pagination.total !== 1 ? "s" : ""}`,
    );

    if (options?.format === "json") {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (agents.length === 0) {
      console.log();
      console.log(chalk.gray("No agents found in this project."));
      console.log(chalk.gray("Create your first agent with:"));
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
      ID: agent.id,
      Type: agent.type,
      Updated: formatRelativeTime(agent.updatedAt),
    }));

    formatTable({
      data: tableData,
      headers: ["Name", "ID", "Type", "Updated"],
      colorMap: {
        Name: chalk.cyan,
        ID: chalk.green,
        Type: chalk.yellow,
      },
    });

    console.log();
    console.log(
      chalk.gray(
        `Use ${chalk.cyan("langwatch agent get <id>")} to view agent details`,
      ),
    );
  } catch (error) {
    spinner.fail();
    if (error instanceof AgentsApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error fetching agents: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};
