import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import { createCliRunPlansService } from "./cli-run-plans-service";
import { describeScope } from "./scopeFlags";

/**
 * Returns the plan rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts).
 *
 * @see specs/features/run-plan-cli.feature
 */
export const getRunPlanCommand = async (
  id: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = createCliRunPlansService();
  const spinner = createSpinner(`Fetching run plan "${id}"...`).start();

  try {
    const plan = await service.get(id);

    spinner.succeed(`Found run plan "${plan.name}"`);

    return {
      data: plan,
      table: () => {
        console.log();
        console.log(chalk.bold("  Run Plan:"));
        console.log(`    ${chalk.gray("ID:")}        ${chalk.green(plan.id)}`);
        console.log(`    ${chalk.gray("Name:")}      ${chalk.cyan(plan.name)}`);
        console.log(`    ${chalk.gray("Slug:")}      ${chalk.yellow(plan.slug)}`);
        console.log(`    ${chalk.gray("Covers:")}    ${describeScope(plan.scope)}`);
        console.log(`    ${chalk.gray("Repeat:")}    ${plan.repeatCount}`);
        console.log(
          `    ${chalk.gray("Simulator:")} ${plan.simulatorModel ?? chalk.gray("project default")}`,
        );
        console.log(
          `    ${chalk.gray("Judge:")}     ${plan.judgeModel ?? chalk.gray("project default")}`,
        );
        console.log(
          `    ${chalk.gray("Archived:")}  ${plan.archivedAt ?? chalk.gray("no")}`,
        );

        console.log();
        console.log(chalk.bold("  Targets:"));
        for (const target of plan.targets) {
          console.log(`    ${chalk.gray("•")} ${target.type}:${target.referenceId}`);
        }

        if (plan.scenarioIds.length > 0) {
          console.log();
          console.log(chalk.bold("  Scenarios:"));
          for (const scenarioId of plan.scenarioIds) {
            console.log(`    ${chalk.gray("•")} ${scenarioId}`);
          }
        }

        if (plan.platformUrl) {
          console.log();
          console.log(`  ${chalk.bold("View:")}  ${chalk.underline(plan.platformUrl)}`);
        }
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "get run plan" });
    process.exit(1);
  }
};
