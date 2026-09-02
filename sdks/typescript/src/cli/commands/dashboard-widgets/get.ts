import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { DashboardWidgetsApiService } from "@/client-sdk/services/dashboard-widgets/dashboard-widgets-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the widget rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts).
 */
export const getDashboardWidgetCommand = async (
  id: string,
  options?: { project?: string },
): Promise<CommandResult | void> => {
  await resolveCredentials({ project: options?.project });

  const service = new DashboardWidgetsApiService();
  const spinner = createSpinner(`Fetching widget "${id}"...`).start();

  try {
    const widget = await service.get(id);

    spinner.succeed(`Found widget "${widget.name}"`);

    return {
      data: widget,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("ID:")}   ${chalk.green(widget.id)}`);
        console.log(`  ${chalk.gray("Name:")} ${chalk.cyan(widget.name)}`);
        console.log();
        console.log(`  ${chalk.gray("Code:")}`);
        for (const line of widget.definition.code.split("\n")) {
          console.log(`    ${line}`);
        }
        if (widget.definition.queries.length > 0) {
          console.log();
          console.log(`  ${chalk.gray("Queries:")}`);
          for (const query of widget.definition.queries) {
            console.log(`    ${chalk.cyan(query.name)}:`);
            for (const line of query.sql.split("\n")) {
              console.log(`      ${line}`);
            }
            if (query.parameters?.length) {
              console.log(
                `      ${chalk.gray("Parameters:")} ${query.parameters.map((p) => p.name).join(", ")}`,
              );
            }
          }
        }
        if (widget.platformUrl) {
          console.log();
          console.log(
            `  ${chalk.bold("View:")}  ${chalk.underline(widget.platformUrl)}`,
          );
        }
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch dashboard widget" });
    process.exit(1);
  }
};
