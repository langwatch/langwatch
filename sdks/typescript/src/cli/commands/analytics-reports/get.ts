import chalk from "chalk";

import { AnalyticsReportsApiService } from "@/client-sdk/services/analytics-reports/analytics-reports-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

/**
 * Returns the analytics report rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts).
 */
export const getAnalyticsReportCommand = async (id: string): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new AnalyticsReportsApiService();
  const spinner = createSpinner(`Fetching analytics report "${id}"...`).start();

  try {
    const report = await service.get(id);

    spinner.succeed(`Found analytics report "${report.name}"`);

    return {
      data: report,
      table: () => {
        console.log();
        console.log(chalk.bold("  Analytics Report Details:"));
        console.log(`    ${chalk.gray("ID:")}      ${chalk.green(report.id)}`);
        console.log(`    ${chalk.gray("Name:")}    ${chalk.cyan(report.name)}`);
        console.log(
          `    ${chalk.gray("Graphs:")}  ${Array.isArray(report.graphs) ? report.graphs.length : 0}`,
        );
        console.log(`    ${chalk.gray("Created:")} ${new Date(report.createdAt).toLocaleString()}`);
        console.log(`    ${chalk.gray("Updated:")} ${new Date(report.updatedAt).toLocaleString()}`);
        if (report.platformUrl) {
          console.log(`    ${chalk.bold("View:")}   ${chalk.underline(report.platformUrl)}`);
        }
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch analytics report" });
    process.exit(1);
  }
};
