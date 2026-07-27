import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { ScenariosApiService } from "@/client-sdk/services/scenarios";
import type { UpdateScenarioBody } from "@/client-sdk/services/scenarios";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import {
  RedTeamOptionError,
  toRedTeamBody,
  type RedTeamCliOptions,
} from "./red-team-options";

export const updateScenarioCommand = async (
  id: string,
  options: {
    name?: string;
    situation?: string;
    criteria?: string;
    labels?: string;
  } & RedTeamCliOptions,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  let redTeam;
  try {
    redTeam = toRedTeamBody(options);
  } catch (error) {
    if (error instanceof RedTeamOptionError) {
      console.error(chalk.red(error.message));
      process.exit(1);
    }
    throw error;
  }

  const service = new ScenariosApiService();
  const spinner = createSpinner(`Updating scenario "${id}"...`).start();

  try {
    const body: UpdateScenarioBody = {};
    if (options.name !== undefined) body.name = options.name;
    if (options.situation !== undefined) body.situation = options.situation;
    if (options.criteria !== undefined)
      body.criteria = options.criteria.split(",").map((c) => c.trim());
    if (options.labels !== undefined)
      body.labels = options.labels.split(",").map((l) => l.trim());

    Object.assign(body, redTeam);

    const scenario = await service.update(id, body);

    spinner.succeed(
      `Updated scenario "${chalk.cyan(scenario.name)}" ${chalk.gray(`(id: ${scenario.id})`)}`,
    );

    return {
      data: scenario,
      table: () => {
        // The spinner's success line is the human output.
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "update scenario" });
    process.exit(1);
  }
};
