import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { ScenariosApiService } from "@/client-sdk/services/scenarios";
import type { UpdateScenarioBody } from "@/client-sdk/services/scenarios";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import {
  RedTeamOptionError,
  mergeRedTeamConfig,
  redTeamConfigPatch,
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
    redTeam = toRedTeamBody(options, { mode: "update" });
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
    // `redTeamConfig` is one JSONB column and a write replaces all of it, so
    // sending the one knob this flag owns would delete every other setting on
    // the scenario — the attack plan, the stop-early score, the obfuscation
    // rate — and report success. Read first, merge, then write. Only when the
    // flag was actually passed; a rename should not pay for the round trip.
    const configPatch = redTeamConfigPatch(options);
    if (configPatch) {
      const existing = await service.get(id);
      redTeam.redTeamConfig = mergeRedTeamConfig(
        configPatch,
        existing.redTeamConfig,
      );
    }

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
