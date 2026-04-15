import chalk from "chalk";
import ora from "ora";
import {
  SuitesApiService,
  SuitesApiError,
  type SuiteTarget,
} from "@/client-sdk/services/suites";
import { checkApiKey } from "../../utils/apiKey";

function parseTargets(targetStrings: string[]): SuiteTarget[] {
  return targetStrings.map((t) => {
    const colonIndex = t.indexOf(":");
    if (colonIndex === -1) {
      console.error(chalk.red(`Error: Invalid target format "${t}". Use <type>:<referenceId> (e.g., http:agent_abc123)`));
      process.exit(1);
    }
    const type = t.slice(0, colonIndex);
    const referenceId = t.slice(colonIndex + 1);
    if (!["prompt", "http", "code", "workflow"].includes(type)) {
      console.error(chalk.red(`Error: Invalid target type "${type}". Must be one of: prompt, http, code, workflow`));
      process.exit(1);
    }
    return { type: type as SuiteTarget["type"], referenceId };
  });
}

export const createSuiteCommand = async (
  name: string,
  options: {
    scenarios?: string;
    targets?: string[];
    repeatCount?: string;
    labels?: string;
    description?: string;
    format?: string;
  },
): Promise<void> => {
  checkApiKey();

  if (!options.scenarios) {
    console.error(chalk.red("Error: --scenarios is required (comma-separated scenario IDs)"));
    process.exit(1);
  }

  if (!options.targets || options.targets.length === 0) {
    console.error(chalk.red("Error: --targets is required (format: <type>:<referenceId>)"));
    process.exit(1);
  }

  const scenarioIds = options.scenarios.split(",").map((s) => s.trim());
  const targets = parseTargets(options.targets);
  const repeatCount = options.repeatCount ? parseInt(options.repeatCount, 10) : 1;
  const labels = options.labels ? options.labels.split(",").map((l) => l.trim()) : [];

  const service = new SuitesApiService();
  const spinner = ora(`Creating suite "${name}"...`).start();

  try {
    const suite = await service.create({
      name,
      description: options.description,
      scenarioIds,
      targets,
      repeatCount,
      labels,
    });

    spinner.succeed(`Suite "${suite.name}" created (${suite.id})`);

    if (options.format === "json") {
      console.log(JSON.stringify(suite, null, 2));
      return;
    }

    console.log();
    console.log(`  ${chalk.gray("ID:")}        ${chalk.green(suite.id)}`);
    console.log(`  ${chalk.gray("Slug:")}      ${chalk.yellow(suite.slug)}`);
    console.log(`  ${chalk.gray("Scenarios:")} ${suite.scenarioIds.length}`);
    console.log(`  ${chalk.gray("Targets:")}   ${suite.targets.length}`);
    console.log(`  ${chalk.gray("Repeat:")}    ${suite.repeatCount}`);
    console.log();
    if ((suite as Record<string, unknown>).platformUrl) {
      console.log(`  ${chalk.bold("View:")}  ${chalk.underline((suite as Record<string, unknown>).platformUrl as string)}`);
    }
    console.log(
      chalk.gray(`Run it with: ${chalk.cyan(`langwatch suite run ${suite.id}`)}`),
    );
  } catch (error) {
    spinner.fail();
    if (error instanceof SuitesApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};
