import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { ScenariosApiService } from "@/client-sdk/services/scenarios";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import {
  RedTeamOptionError,
  redTeamConfigPatch,
  toRedTeamBody,
  type RedTeamCliOptions,
} from "./red-team-options";

export const createScenarioCommand = async (
  name: string,
  options: {
    situation: string;
    criteria?: string;
    labels?: string;
  } & RedTeamCliOptions,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  let redTeam;
  try {
    redTeam = toRedTeamBody(options, { mode: "create" });
    // Nothing stored to merge over on a new scenario, so the patch is the
    // whole config.
    const configPatch = redTeamConfigPatch(options);
    if (configPatch) redTeam.redTeamConfig = configPatch;
  } catch (error) {
    if (error instanceof RedTeamOptionError) {
      console.error(chalk.red(error.message));
      process.exit(1);
    }
    throw error;
  }

  const service = new ScenariosApiService();
  const spinner = createSpinner(`Creating scenario "${name}"...`).start();

  try {
    const criteria = options.criteria
      ? options.criteria.split(",").map((c) => c.trim())
      : [];
    const labels = options.labels
      ? options.labels.split(",").map((l) => l.trim())
      : [];

    const scenario = await service.create({
      name,
      situation: options.situation,
      criteria,
      labels,
      ...redTeam,
    });

    spinner.succeed(
      `Created ${redTeam.redTeamStrategy ? `${chalk.red("red-team")} ` : ""}scenario "${chalk.cyan(scenario.name)}" ${chalk.gray(`(id: ${scenario.id})`)}`,
    );

    return {
      data: scenario,
      table: () => {
        if (scenario.platformUrl) {
          console.log(`  ${chalk.bold("View:")}  ${chalk.underline(scenario.platformUrl)}`);
        }
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "create scenario" });
    process.exit(1);
  }
};
