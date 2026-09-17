/**
 * `langwatch query schema` — the LangWatchQL datasets and columns.
 *
 * The same document `langwatch chart schema` prints, on the query family it
 * belongs to: a statement run through `langwatch query` has nothing to do with
 * a saved chart, and asking about charts to learn a column name is the kind of
 * indirection an agent gets wrong. `chart schema` stays where it is, because
 * the chart skill's routing test pins its wording.
 *
 * @see specs/analytics/lwql-cli-query.feature
 */

import chalk from "chalk";

import { QueryApiService } from "@/client-sdk/services/query/query-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

export const queryLwqlSchemaCommand = async (options?: {
  project?: string;
}): Promise<CommandResult | void> => {
  await resolveCredentials({ project: options?.project });

  const service = new QueryApiService();
  const spinner = createSpinner("Fetching the query schema...").start();

  try {
    const schema = await service.schema();

    spinner.succeed(
      `${schema.datasets.length} dataset${schema.datasets.length !== 1 ? "s" : ""} in ${schema.database}`,
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
              Unit: column.unit ?? "",
              Available: column.available ? "yes" : "no",
            })),
            headers: ["Column", "Type", "Unit", "Available"],
          });
        }
        console.log();
        console.log(
          chalk.gray(
            `Worked statements: ${chalk.cyan("langwatch query examples")}. Both query languages: ${chalk.cyan("langwatch query reference")}.`,
          ),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch the query schema" });
    process.exit(1);
  }
};
