import chalk from "chalk";

import { ChartsApiService } from "@/client-sdk/services/charts/charts-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import { commandValidationError } from "../../utils/errorOutput";
import { formatTable } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

/**
 * Returns the LangWatchQL analytics schema rather than printing it (output
 * port renders per-format). The discovery step an agent runs before writing
 * chart SQL -- dataset and column names come from here, never guessing.
 */
export const chartSchemaCommand = async (options?: {
  project?: string;
}): Promise<CommandResult | void> => {
  await resolveCredentials({ project: options?.project });

  const service = new ChartsApiService();
  const spinner = createSpinner("Fetching analytics schema...").start();

  try {
    const schema = await service.schema();

    // The payload is read straight into `.views.length` below, so a server
    // that answers with a different shape used to crash here and be reported
    // as a network failure. Name the mismatch instead: an older CLI against a
    // newer platform is the case this actually happens in, and "update the
    // CLI" is something the reader can act on.
    if (!Array.isArray(schema?.views)) {
      failSpinner({
        spinner,
        error: commandValidationError(
          "The analytics schema came back in a shape this CLI does not recognise. Update it with `npm install -g langwatch@latest`, which is usually an older CLI against a newer LangWatch.",
          { received: typeof schema },
        ),
        action: "fetch analytics schema",
      });
      process.exit(1);
    }

    spinner.succeed(
      `Found ${schema.views.length} view${schema.views.length !== 1 ? "s" : ""} in ${schema.database}`,
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
              Available: column.available ? "yes" : "no",
            })),
            headers: ["Column", "Type", "Available"],
          });
        }
        console.log();
        console.log(
          chalk.gray(
            `Use ${chalk.cyan("langwatch chart schema -o json")} for descriptions and example queries`,
          ),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch analytics schema" });
    process.exit(1);
  }
};
