import chalk from "chalk";
import ora from "ora";
import {
  AgentsApiService,
  AgentsApiError,
} from "@/client-sdk/services/agents/agents-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";

export const runAgentCommand = async (
  id: string,
  options: { input?: string; format?: string },
): Promise<void> => {
  checkApiKey();

  const service = new AgentsApiService();

  // First get the agent to determine its type
  const resolveSpinner = ora(`Fetching agent "${id}"...`).start();

  let agent;
  try {
    agent = await service.get(id);
    resolveSpinner.succeed(`Found agent "${agent.name}" (type: ${agent.type})`);
  } catch (error) {
    resolveSpinner.fail();
    if (error instanceof AgentsApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(chalk.red(`Error: ${formatApiErrorMessage({ error })}`));
    }
    process.exit(1);
  }

  let input: Record<string, unknown> = {};
  if (options.input) {
    try {
      input = JSON.parse(options.input) as Record<string, unknown>;
    } catch {
      console.error(chalk.red("Error: --input must be valid JSON"));
      process.exit(1);
    }
  }

  const config = agent.config;

  if (agent.type === "http") {
    // HTTP agent — call the URL directly
    const url = config?.url as string | undefined;
    if (!url) {
      console.error(chalk.red("Error: HTTP agent has no URL configured"));
      process.exit(1);
    }

    const runSpinner = ora(`Calling HTTP agent at ${url}...`).start();
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      const result = await response.json() as Record<string, unknown>;
      runSpinner.succeed(`HTTP agent responded (${response.status})`);

      if (options.format === "json") {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log();
        console.log(chalk.bold("  Response:"));
        console.log(`    ${JSON.stringify(result, null, 2).split("\n").join("\n    ")}`);
        console.log();
      }
    } catch (error) {
      runSpinner.fail();
      console.error(chalk.red(`Error calling agent: ${formatApiErrorMessage({ error })}`));
      process.exit(1);
    }
  } else {
    // For signature/code/workflow agents, try to run via the workflow API
    const apiKey = process.env.LANGWATCH_API_KEY ?? "";
    const endpoint = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

    // Check if agent has a linked workflow
    const workflowId = config?.workflowId as string | undefined;
    if (!workflowId) {
      console.error(chalk.yellow(
        `Agent "${agent.name}" (type: ${agent.type}) cannot be executed directly from CLI.\n` +
        `Only HTTP agents and workflow-linked agents can be run.\n` +
        `To test this agent, use it within a workflow in the UI.`,
      ));
      process.exit(1);
    }

    const runSpinner = ora(`Running agent via workflow ${workflowId}...`).start();
    try {
      const response = await fetch(
        `${endpoint}/api/workflows/${encodeURIComponent(workflowId)}/run`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Auth-Token": apiKey,
          },
          body: JSON.stringify(input),
        },
      );

      if (!response.ok) {
        const message = await formatFetchError(response);
        runSpinner.fail(`Agent execution failed: ${message}`);
        process.exit(1);
      }

      const result = await response.json() as Record<string, unknown>;
      runSpinner.succeed(`Agent "${agent.name}" executed successfully`);

      if (options.format === "json") {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log();
        if (result.output !== undefined) {
          console.log(chalk.bold("  Output:"));
          const output = typeof result.output === "string"
            ? result.output
            : JSON.stringify(result.output, null, 2);
          console.log(`    ${output.split("\n").join("\n    ")}`);
        } else {
          console.log(chalk.bold("  Result:"));
          console.log(`    ${JSON.stringify(result, null, 2).split("\n").join("\n    ")}`);
        }
        console.log();
      }
    } catch (error) {
      runSpinner.fail();
      console.error(chalk.red(`Error: ${formatApiErrorMessage({ error })}`));
      process.exit(1);
    }
  }
};
