import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import {
  type ChartParameterValue,
  ChartsApiService,
} from "@/client-sdk/services/charts/charts-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Runs a saved chart by id: reads the chart, then executes its own statement
 * and stored parameter values through the LangWatchQL query door — the same
 * governed execution path every other surface uses, so what this prints is
 * what the workbench would show. `--start`/`--end` fill the reserved
 * `period_start`/`period_end` parameters for statements that declare them,
 * and `--granularity` the reserved datapoint step, in seconds.
 */
export const runChartCommand = async (
  id: string,
  options: {
    start?: string;
    end?: string;
    granularity?: string;
    project?: string;
  },
): Promise<CommandResult | void> => {
  await resolveCredentials({ project: options.project });

  if ((options.start === undefined) !== (options.end === undefined)) {
    console.error(
      chalk.red("Error: --start and --end must be given together"),
    );
    process.exit(1);
  }
  let granularitySeconds: number | undefined;
  if (options.granularity !== undefined) {
    granularitySeconds = Number(options.granularity);
    if (!Number.isInteger(granularitySeconds) || granularitySeconds <= 0) {
      console.error(
        chalk.red("Error: --granularity must be a positive whole number of seconds"),
      );
      process.exit(1);
    }
  }

  const service = new ChartsApiService();
  const spinner = createSpinner(`Running chart "${id}"...`).start();

  try {
    const chart = await service.get(id);
    const result = await service.runQuery({
      sql: chart.definition.sql,
      parameters: chart.definition.parameters as Record<
        string,
        ChartParameterValue
      >,
      ...(options.start !== undefined && options.end !== undefined
        ? { timeWindow: { start: options.start, end: options.end } }
        : {}),
      ...(granularitySeconds === undefined ? {} : { granularitySeconds }),
    });

    spinner.succeed(
      `Ran chart "${chart.name}": ${result.rows.length} row${result.rows.length !== 1 ? "s" : ""} in ${result.statistics.elapsedMs}ms`,
    );

    return {
      data: { chart: { id: chart.id, name: chart.name }, result },
      table: () => {
        console.log();
        if (result.rows.length === 0) {
          console.log(chalk.gray("The query returned no rows."));
        } else {
          const headers = result.columns.map((column) => column.name);
          formatTable({
            data: result.rows.map((row) =>
              Object.fromEntries(
                headers.map((name) => {
                  const value = row[name];
                  return [
                    name,
                    value === null || value === undefined
                      ? ""
                      : typeof value === "object"
                        ? JSON.stringify(value)
                        : String(value as string | number | boolean),
                  ];
                }),
              ),
            ),
            headers,
          });
        }
        if (result.truncated) {
          console.log();
          console.log(chalk.yellow("The result was truncated."));
        }
        for (const diagnostic of result.diagnostics) {
          console.log();
          console.log(chalk.yellow(`${diagnostic.code}: ${diagnostic.message}`));
        }
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "run chart" });
    process.exit(1);
  }
};
