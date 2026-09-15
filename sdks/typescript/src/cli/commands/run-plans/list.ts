import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { resolveCredentials } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import { createCliRunPlansService } from "./cli-run-plans-service";
import { describeScope } from "./scopeFlags";

/**
 * Returns the listing rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts).
 *
 * @see specs/features/run-plan-cli.feature
 */
export const listRunPlansCommand = async (options: {
  archived?: boolean;
}): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = createCliRunPlansService();
  const spinner = createSpinner("Fetching run plans...").start();

  try {
    const plans = await service.list({ includeArchived: options.archived });

    spinner.succeed(`Found ${plans.length} run plan${plans.length !== 1 ? "s" : ""}`);

    return {
      data: plans,
      table: () => {
        if (plans.length === 0) {
          console.log();
          console.log(chalk.gray("No run plans found in this project."));
          console.log(chalk.gray("Start one with:"));
          console.log(chalk.cyan("  langwatch run-plan run --all --target http:<agentId>"));
          return;
        }

        console.log();

        formatTable({
          data: plans.map((plan) => ({
            Name: plan.name,
            ID: plan.id,
            Covers: describeScope(plan.scope),
            Targets: `${plan.targets.length}`,
            Repeat: `${plan.repeatCount}`,
            Archived: plan.archivedAt ? "yes" : "no",
          })),
          headers: ["Name", "ID", "Covers", "Targets", "Repeat", "Archived"],
          colorMap: {
            Name: chalk.cyan,
            ID: chalk.green,
          },
        });

        console.log();
        console.log(
          chalk.gray(`Use ${chalk.cyan("langwatch run-plan get <id>")} to read one plan.`),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "list run plans" });
    process.exit(1);
  }
};
