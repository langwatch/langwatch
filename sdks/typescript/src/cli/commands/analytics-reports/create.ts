import chalk from "chalk";

import { AnalyticsReportsApiService } from "@/client-sdk/services/analytics-reports/analytics-reports-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

/**
 * Returns the created analytics report rather than printing it: the output port
 * renders it in whatever format the caller asked for (utils/output.ts).
 */
export const createAnalyticsReportCommand = async (name: string): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new AnalyticsReportsApiService();
  const spinner = createSpinner(`Creating analytics report "${name}"...`).start();

  try {
    const report = await service.create({ name });

    spinner.succeed(
      `Created analytics report "${chalk.cyan(report.name)}" ${chalk.gray(`(id: ${report.id})`)}`,
    );

    return {
      data: report,
      table: () => {
        if (report.platformUrl) {
          console.log(`  ${chalk.bold("View:")}  ${chalk.underline(report.platformUrl)}`);
        }
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "create analytics report" });
    process.exit(1);
  }
};
