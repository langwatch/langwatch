import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { AgentsApiService } from "@/client-sdk/services/agents/agents-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the agent rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts). The `table` closure
 * is the human form, byte-identical to what this command printed before.
 */
export const getAgentCommand = async (id: string): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new AgentsApiService();
  const spinner = createSpinner(`Fetching agent "${id}"...`).start();

  try {
    const agent = await service.get(id);
    spinner.succeed(`Found agent "${agent.name}"`);

    return {
      data: agent,
      table: () => {
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
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch agent" });
    process.exit(1);
  }
};
