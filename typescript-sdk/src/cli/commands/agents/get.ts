import chalk from "chalk";
import ora from "ora";
import {
  AgentsApiService,
  AgentsApiError,
} from "@/client-sdk/services/agents/agents-api.service";
import { checkApiKey } from "../../utils/apiKey";

export const getAgentCommand = async (id: string, options?: { format?: string }): Promise<void> => {
  checkApiKey();

  const service = new AgentsApiService();
  const spinner = ora(`Fetching agent "${id}"...`).start();

  try {
    const agent = await service.get(id);
    spinner.succeed(`Found agent "${agent.name}"`);

    if (options?.format === "json") {
      console.log(JSON.stringify(agent, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold.cyan(agent.name));
    console.log(chalk.gray("─".repeat(40)));
    console.log(`  ${chalk.gray("ID:")}      ${agent.id}`);
    console.log(`  ${chalk.gray("Type:")}    ${chalk.yellow(agent.type)}`);
    console.log(`  ${chalk.gray("Created:")} ${new Date(agent.createdAt).toLocaleString()}`);
    console.log(`  ${chalk.gray("Updated:")} ${new Date(agent.updatedAt).toLocaleString()}`);

    if (agent.platformUrl) {
      console.log(`  ${chalk.bold("View:")}  ${chalk.underline(agent.platformUrl)}`);
    }

    if (agent.config && Object.keys(agent.config).length > 0) {
      console.log();
      console.log(chalk.bold("  Config:"));
      console.log(`    ${JSON.stringify(agent.config, null, 2).split("\n").join("\n    ")}`);
    }

    console.log();
  } catch (error) {
    spinner.fail();
    if (error instanceof AgentsApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error fetching agent: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};
