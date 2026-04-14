import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";

export const getSimulationRunCommand = async (
  runId: string,
  options?: { format?: string },
): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora(`Fetching simulation run "${runId}"...`).start();

  try {
    const response = await fetch(
      `${endpoint}/api/simulation-runs/${encodeURIComponent(runId)}`,
      {
        method: "GET",
        headers: { "X-Auth-Token": apiKey },
      },
    );

    if (!response.ok) {
      if (response.status === 404) {
        spinner.fail(`Simulation run "${runId}" not found`);
      } else {
        const errorBody = await response.text();
        spinner.fail(`Failed to fetch simulation run (${response.status})`);
        console.error(chalk.red(`Error: ${errorBody}`));
      }
      process.exit(1);
    }

    const run = await response.json() as {
      scenarioRunId: string;
      scenarioId: string;
      batchRunId: string;
      name: string | null;
      description: string | null;
      status: string;
      results: {
        verdict?: string | null;
        reasoning?: string | null;
        metCriteria?: string[];
        unmetCriteria?: string[];
        error?: string | null;
      } | null;
      messages: Array<{ role: string; content: string }>;
      timestamp: number;
      updatedAt: number;
      durationInMs: number;
      totalCost?: number;
    };

    spinner.succeed(`Found simulation run "${run.name ?? run.scenarioRunId}"`);

    if (options?.format === "json") {
      console.log(JSON.stringify(run, null, 2));
      return;
    }

    const statusColor = run.status === "SUCCESS" ? chalk.green
      : run.status === "FAILED" ? chalk.red
      : run.status === "ERROR" ? chalk.red
      : chalk.yellow;

    console.log();
    console.log(chalk.bold("  Simulation Run Details:"));
    console.log(`    ${chalk.gray("Run ID:")}      ${chalk.green(run.scenarioRunId)}`);
    console.log(`    ${chalk.gray("Scenario ID:")} ${run.scenarioId}`);
    console.log(`    ${chalk.gray("Batch ID:")}    ${run.batchRunId}`);
    console.log(`    ${chalk.gray("Name:")}        ${run.name ?? chalk.gray("—")}`);
    console.log(`    ${chalk.gray("Status:")}      ${statusColor(run.status)}`);
    console.log(`    ${chalk.gray("Duration:")}    ${run.durationInMs > 0 ? `${(run.durationInMs / 1000).toFixed(1)}s` : "—"}`);
    if (run.totalCost) {
      console.log(`    ${chalk.gray("Cost:")}        $${run.totalCost.toFixed(4)}`);
    }
    console.log(`    ${chalk.gray("Started:")}     ${new Date(run.timestamp).toLocaleString()}`);

    if (run.results) {
      console.log();
      console.log(chalk.bold("  Results:"));
      if (run.results.verdict) {
        const verdictColor = run.results.verdict === "passed" ? chalk.green : chalk.red;
        console.log(`    ${chalk.gray("Verdict:")}    ${verdictColor(run.results.verdict)}`);
      }
      if (run.results.reasoning) {
        console.log(`    ${chalk.gray("Reasoning:")}  ${run.results.reasoning}`);
      }
      if (run.results.metCriteria && run.results.metCriteria.length > 0) {
        console.log(`    ${chalk.gray("Met:")}        ${chalk.green(run.results.metCriteria.join(", "))}`);
      }
      if (run.results.unmetCriteria && run.results.unmetCriteria.length > 0) {
        console.log(`    ${chalk.gray("Unmet:")}      ${chalk.red(run.results.unmetCriteria.join(", "))}`);
      }
      if (run.results.error) {
        console.log(`    ${chalk.gray("Error:")}      ${chalk.red(run.results.error)}`);
      }
    }

    if (run.messages && run.messages.length > 0) {
      console.log();
      console.log(chalk.bold("  Conversation:"));
      for (const msg of run.messages) {
        const roleColor = msg.role === "user" ? chalk.blue
          : msg.role === "assistant" ? chalk.green
          : chalk.gray;
        const content = msg.content.length > 200
          ? msg.content.slice(0, 200) + "..."
          : msg.content;
        console.log(`    ${roleColor(`[${msg.role}]`)} ${content}`);
      }
    }

    console.log();
  } catch (error) {
    spinner.fail();
    console.error(
      chalk.red(
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      ),
    );
    process.exit(1);
  }
};
