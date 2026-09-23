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
 * The datapoint steps the platform offers, in seconds. The API
 * (`LWQL_GRANULARITY_STEPS`) is the source of truth; this local copy exists
 * only to refuse an off-list value early, naming the steps in the message.
 */
const OFFERED_GRANULARITY_STEPS = [1, 60, 3600] as const;

/**
 * One of the offered datapoint steps, validated locally against
 * `OFFERED_GRANULARITY_STEPS`. `runQuery` accepts the plain `number` the
 * shared query door types it as (#7565): the door doesn't know this CLI's list.
 */
type ChartRunGranularitySeconds = (typeof OFFERED_GRANULARITY_STEPS)[number];

const OFFERED_GRANULARITY_STEP_NAMES = "1 (1 second), 60 (1 minute), 3600 (1 hour)";

const formatChartCellValue = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value as string | number | boolean);
};

/**
 * Runs a saved chart through LangWatchQL (same path as workbench). --start/--end
 * and --granularity fill reserved dashboard context parameters.
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
    console.error(chalk.red("Error: --start and --end must be given together"));
    process.exit(1);
  }
  let granularitySeconds: ChartRunGranularitySeconds | undefined;
  if (options.granularity !== undefined) {
    const requested = Number(options.granularity);
    if (!(OFFERED_GRANULARITY_STEPS as readonly number[]).includes(requested)) {
      console.error(
        chalk.red(
          `Error: --granularity must be one of the offered steps: ${OFFERED_GRANULARITY_STEP_NAMES}`,
        ),
      );
      process.exit(1);
    }
    // The `includes` check above proves `requested` is one of the offered
    // steps, but `Array<T>.includes` doesn't narrow its argument's type —
    // this cast just names what was already true at runtime.
    granularitySeconds = requested as ChartRunGranularitySeconds;
  }

  const service = new ChartsApiService();
  const spinner = createSpinner(`Running chart "${id}"...`).start();

  try {
    const chart = await service.get(id);
    const result = await service.runQuery({
      sql: chart.definition.sql,
      parameters: chart.definition.parameters as Record<string, ChartParameterValue>,
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
                  return [name, formatChartCellValue(value)];
                }),
              ),
            ),
            headers,
          });
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
