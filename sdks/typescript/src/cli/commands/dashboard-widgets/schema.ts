import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
// The schema endpoint is a project-wide LangWatchQL discovery surface, not a
// widget-specific one — `ChartsApiService` already carries it, so dashboard
// widgets reuse it rather than duplicating the same request on a second
// service class.
import { ChartsApiService } from "@/client-sdk/services/charts/charts-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the LangWatchQL analytics schema rather than printing it: the
 * output port renders it in whatever format the caller asked for
 * (utils/output.ts). This is the discovery step an agent runs before writing
 * a widget's queries — dataset and column names come from here, never from
 * guessing.
 */
export const dashboardWidgetSchemaCommand = async (options?: {
  project?: string;
}): Promise<CommandResult | void> => {
  await resolveCredentials({ project: options?.project });

  const service = new ChartsApiService();
  const spinner = createSpinner("Fetching analytics schema...").start();

  try {
    const schema = await service.schema();

    spinner.succeed(
      `Found ${schema.datasets.length} dataset${schema.datasets.length !== 1 ? "s" : ""} in ${schema.database}`,
    );

    return {
      data: schema,
      table: () => {
        for (const dataset of schema.datasets) {
          console.log();
          console.log(
            `  ${chalk.cyan.bold(dataset.name)} ${chalk.gray(`— ${dataset.description}`)}`,
          );
          console.log(
            `  ${chalk.gray("Grain:")} ${dataset.grain}  ${chalk.gray("Time column:")} ${dataset.timeColumn}`,
          );
          formatTable({
            data: dataset.columns.map((column) => ({
              Column: column.name,
              Type: column.type,
              Available: column.available ? "yes" : "no",
            })),
            headers: ["Column", "Type", "Available"],
          });
        }
        console.log();
        console.log(
          chalk.gray(
            `Use ${chalk.cyan("langwatch dashboard-widget schema -o json")} for descriptions and example queries`,
          ),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch analytics schema" });
    process.exit(1);
  }
};
