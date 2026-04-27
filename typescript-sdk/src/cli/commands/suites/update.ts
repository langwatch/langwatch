import chalk from "chalk";
import ora from "ora";
import {
  SuitesApiService,
  type SuiteTarget,
} from "@/client-sdk/services/suites";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

function parseTargets(targetStrings: string[]): SuiteTarget[] {
  return targetStrings.map((t) => {
    const colonIndex = t.indexOf(":");
    if (colonIndex === -1) {
      console.error(chalk.red(`Error: Invalid target format "${t}". Use <type>:<referenceId>`));
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

export const updateSuiteCommand = async (
  id: string,
  options: {
    name?: string;
    scenarios?: string;
    targets?: string[];
    repeatCount?: string;
    labels?: string;
    description?: string;
    format?: string;
  },
): Promise<void> => {
  checkApiKey();

  const service = new SuitesApiService();
  const spinner = ora(`Updating suite "${id}"...`).start();

  try {
    const updateData: Record<string, unknown> = {};
    if (options.name) updateData.name = options.name;
    if (options.description !== undefined) updateData.description = options.description;
    if (options.scenarios) updateData.scenarioIds = options.scenarios.split(",").map((s) => s.trim());
    if (options.targets && options.targets.length > 0) updateData.targets = parseTargets(options.targets);
    if (options.repeatCount) updateData.repeatCount = parseInt(options.repeatCount, 10);
    if (options.labels) updateData.labels = options.labels.split(",").map((l) => l.trim());

    const suite = await service.update(id, updateData);

    spinner.succeed(`Suite "${suite.name}" updated`);

    if (options.format === "json") {
      console.log(JSON.stringify(suite, null, 2));
      return;
    }

    console.log();
    console.log(`  ${chalk.gray("ID:")}        ${chalk.green(suite.id)}`);
    console.log(`  ${chalk.gray("Name:")}      ${chalk.cyan(suite.name)}`);
    console.log(`  ${chalk.gray("Slug:")}      ${chalk.yellow(suite.slug)}`);
    console.log(`  ${chalk.gray("Scenarios:")} ${suite.scenarioIds.length}`);
    console.log(`  ${chalk.gray("Targets:")}   ${suite.targets.length}`);
    console.log(`  ${chalk.gray("Repeat:")}    ${suite.repeatCount}`);
    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "update suite" });
    process.exit(1);
  }
};
