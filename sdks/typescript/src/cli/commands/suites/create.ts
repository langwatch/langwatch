import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import {
  SuitesApiService,
  type SuiteTarget,
} from "@/client-sdk/services/suites";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import {
  buildScope,
  describeScope,
  hasScopeFlag,
  type ScopeOptions,
} from "./scopeFlags";

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

/**
 * Returns the created suite rather than printing it: the output port renders it
 * in whatever format the caller asked for (utils/output.ts).
 */
export const createSuiteCommand = async (
  name: string,
  options: ScopeOptions & {
    scenarios?: string;
    targets?: string[];
    repeatCount?: string;
    labels?: string;
    description?: string;
  },
): Promise<CommandResult | void> => {
  await resolveCredentials();

  if (!options.scenarios && !hasScopeFlag(options)) {
    console.error(chalk.red("Error: --scenarios is required (comma-separated scenario IDs), unless the plan is given a scope with --scope-all, --scope-folder or --scope-label"));
    process.exit(1);
  }

  if (!options.targets || options.targets.length === 0) {
    console.error(chalk.red("Error: --targets is required (format: <type>:<referenceId>)"));
    process.exit(1);
  }

  const service = new SuitesApiService();
  const scope = await buildScope(options, service);
  const scenarioIds = options.scenarios
    ? options.scenarios.split(",").map((s) => s.trim())
    : [];
  const targets = parseTargets(options.targets);
  const repeatCount = options.repeatCount ? parseInt(options.repeatCount, 10) : 1;
  const labels = options.labels ? options.labels.split(",").map((l) => l.trim()) : [];

  const spinner = createSpinner(`Creating suite "${name}"...`).start();

  try {
    const suite = await service.create({
      name,
      description: options.description,
      scenarioIds,
      ...(scope && { scope }),
      targets,
      repeatCount,
      labels,
    });

    spinner.succeed(`Suite "${suite.name}" created (${suite.id})`);

    return {
      data: suite,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("ID:")}        ${chalk.green(suite.id)}`);
        console.log(`  ${chalk.gray("Slug:")}      ${chalk.yellow(suite.slug)}`);
        console.log(`  ${chalk.gray("Covers:")}    ${describeScope(suite.scope)}`);
        console.log(`  ${chalk.gray("Scenarios:")} ${suite.scenarioIds.length}`);
        console.log(`  ${chalk.gray("Targets:")}   ${suite.targets.length}`);
        console.log(`  ${chalk.gray("Repeat:")}    ${suite.repeatCount}`);
        console.log();
        if (suite.platformUrl) {
          console.log(`  ${chalk.bold("View:")}  ${chalk.underline(suite.platformUrl)}`);
        }
        console.log(
          chalk.gray(`Run it with: ${chalk.cyan(`langwatch suite run ${suite.id}`)}`),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "create suite" });
    process.exit(1);
  }
};
