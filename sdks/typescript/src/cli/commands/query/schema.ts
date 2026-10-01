/**
 * `langwatch query schema` — the LangWatchQL views and columns, the document
 * `langwatch chart schema` prints, on the family it belongs to: asking about
 * charts to learn a column name is indirection an agent gets wrong.
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
      `${schema.views.length} view${schema.views.length !== 1 ? "s" : ""} in ${schema.database}`,
    );

    return {
      data: schema,
      table: () => {
        for (const view of schema.views) {
          console.log();
          console.log(`  ${chalk.cyan.bold(view.name)} ${chalk.gray(`— ${view.description}`)}`);
          console.log(
            `  ${chalk.gray("Grain:")} ${view.grain}  ${chalk.gray("Time column:")} ${view.timeColumn}`,
          );
          formatTable({
            data: view.columns.map((column) => ({
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
