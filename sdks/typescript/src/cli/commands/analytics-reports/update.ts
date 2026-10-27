import chalk from "chalk";

import { AnalyticsReportsApiService } from "@/client-sdk/services/analytics-reports/analytics-reports-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

/**
 * Returns the renamed analytics report rather than printing it: the output port
 * renders it in whatever format the caller asked for (utils/output.ts).
 */
export const updateAnalyticsReportCommand = async (
  id: string,
  options: { name?: string },
): Promise<CommandResult | void> => {
  await resolveCredentials();

  if (!options.name) {
    console.error(chalk.red("Error: --name is required"));
    process.exit(1);
  }

  const service = new AnalyticsReportsApiService();
  const spinner = createSpinner(`Updating analytics report "${id}"...`).start();

  try {
    const report = await service.rename(id, { name: options.name });

    spinner.succeed(`Analytics report renamed to "${report.name}"`);

    return {
      data: report,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("ID:")}   ${chalk.green(report.id)}`);
        console.log(`  ${chalk.gray("Name:")} ${chalk.cyan(report.name)}`);
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "update analytics report" });
    process.exit(1);
  }
};
