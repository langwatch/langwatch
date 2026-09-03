import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import {
  AgentsApiService,
  type AgentParameterSpec,
} from "@/client-sdk/services/agents/agents-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/** One parameter on one line: name, type, options, default and whether it is required. */
export const describeParameter = (parameter: AgentParameterSpec): string => {
  const parts: string[] = [parameter.type];
  if (parameter.options?.length) parts.push(`one of ${parameter.options.join(", ")}`);
  if (parameter.default !== undefined) parts.push(`default ${JSON.stringify(parameter.default)}`);
  if (parameter.required) parts.push("required");
  const description = parameter.description ? ` ${chalk.gray(parameter.description)}` : "";
  return `${parameter.name}: ${parts.join(", ")}${description}`;
};

/**
 * Returns the agent rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts). The `table` closure
 * is the human form.
 *
 * @see specs/typescript-sdk/cli-agents.feature
 */
export const getAgentCommand = async (id: string): Promise<CommandResult | void> => {
  await resolveCredentials();

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
        console.log(`  ${chalk.gray("ID:")}          ${agent.id}`);
        console.log(`  ${chalk.gray("Type:")}        ${chalk.yellow(agent.type)}`);
        if (agent.environment) {
          console.log(`  ${chalk.gray("Environment:")} ${agent.environment}`);
        }
        if (agent.status) {
          const status = agent.status === "online" ? chalk.green("online") : chalk.gray("offline");
          console.log(`  ${chalk.gray("Status:")}      ${status}`);
        }
        if (agent.owner?.name) {
          console.log(`  ${chalk.gray("Owner:")}       ${agent.owner.name}`);
        } else if (agent.hostLabel) {
          console.log(`  ${chalk.gray("Host:")}        ${agent.hostLabel}`);
        }
        if (agent.lastSeenAt) {
          console.log(
            `  ${chalk.gray("Last seen:")}   ${new Date(agent.lastSeenAt).toLocaleString()}`,
          );
        }
        console.log(
          `  ${chalk.gray("Created:")}     ${new Date(agent.createdAt).toLocaleString()}`,
        );
        console.log(
          `  ${chalk.gray("Updated:")}     ${new Date(agent.updatedAt).toLocaleString()}`,
        );

        if (agent.platformUrl) {
          console.log(`  ${chalk.bold("View:")}        ${chalk.underline(agent.platformUrl)}`);
        }

        if (agent.parameters && agent.parameters.length > 0) {
          console.log();
          console.log(chalk.bold("  Parameters:"));
          for (const parameter of agent.parameters) {
            console.log(`    ${describeParameter(parameter)}`);
          }
        }

        if (agent.instances && agent.instances.length > 0) {
          console.log();
          console.log(chalk.bold(`  Instances (${agent.instances.length}):`));
          for (const instance of agent.instances) {
            const label = instance.label ? ` (${instance.label})` : "";
            const since = instance.connectedAt
              ? ` since ${new Date(instance.connectedAt).toLocaleString()}`
              : "";
            console.log(`    ${instance.hostname || instance.id}${label}${since}`);
          }
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
