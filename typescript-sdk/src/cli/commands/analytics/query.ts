import chalk from "chalk";
import ora from "ora";
import {
  AnalyticsApiService,
  AnalyticsApiError,
} from "@/client-sdk/services/analytics/analytics-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";

const METRIC_PRESETS: Record<string, { metric: string; aggregation: string }> = {
  "trace-count": { metric: "metadata.trace_id", aggregation: "cardinality" },
  "user-count": { metric: "metadata.user_id", aggregation: "cardinality" },
  "total-cost": { metric: "performance.total_cost", aggregation: "sum" },
  "avg-latency": { metric: "performance.completion_time", aggregation: "avg" },
  "p95-latency": { metric: "performance.completion_time", aggregation: "p95" },
  "total-tokens": { metric: "performance.total_tokens", aggregation: "sum" },
  "avg-tokens": { metric: "performance.total_tokens", aggregation: "avg" },
  "eval-pass-rate": { metric: "evaluations.evaluation_pass_rate", aggregation: "avg" },
};

export const queryAnalyticsCommand = async (options: {
  metric?: string;
  aggregation?: string;
  startDate?: string;
  endDate?: string;
  groupBy?: string;
  timeScale?: string;
  format?: string;
}): Promise<void> => {
  checkApiKey();

  const service = new AnalyticsApiService();

  // Resolve metric preset or use raw metric/aggregation
  let metric: string;
  let aggregation: string;

  if (options.metric && options.metric in METRIC_PRESETS) {
    const preset = METRIC_PRESETS[options.metric]!;
    metric = preset.metric;
    aggregation = options.aggregation ?? preset.aggregation;
  } else {
    metric = options.metric ?? "metadata.trace_id";
    aggregation = options.aggregation ?? "cardinality";
  }

  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  const startDate = options.startDate
    ? new Date(options.startDate).getTime()
    : sevenDaysAgo;
  const endDate = options.endDate
    ? new Date(options.endDate).getTime()
    : now;

  const spinner = ora(`Querying ${metric} (${aggregation})...`).start();

  try {
    const result = await service.timeseries({
      startDate,
      endDate,
      series: [
        {
          metric: metric as "metadata.trace_id",
          aggregation: aggregation as "cardinality",
        },
      ],
      groupBy: options.groupBy as "metadata.model" | undefined,
      timeScale: options.timeScale === "full" ? "full" : options.timeScale ? Number(options.timeScale) : undefined,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });

    spinner.succeed("Analytics query complete");

    if (options.format === "json") {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold("Current Period:"));

    if (result.currentPeriod.length === 0) {
      console.log(chalk.gray("  No data for the current period."));
    } else {
      for (const dataPoint of result.currentPeriod) {
        const entries = Object.entries(dataPoint).filter(
          ([key]) => key !== "date",
        );
        const dateStr = dataPoint.date
          ? new Date(dataPoint.date as number).toLocaleDateString()
          : "—";

        if (entries.length === 0) {
          console.log(`  ${chalk.gray(dateStr)}: ${chalk.gray("no data")}`);
        } else {
          const values = entries
            .map(([key, value]) => `${chalk.cyan(key)}: ${formatValue(value)}`)
            .join(", ");
          console.log(`  ${chalk.gray(dateStr)}: ${values}`);
        }
      }
    }

    if (result.previousPeriod.length > 0) {
      console.log();
      console.log(chalk.bold("Previous Period:"));
      for (const dataPoint of result.previousPeriod) {
        const entries = Object.entries(dataPoint).filter(
          ([key]) => key !== "date",
        );
        const dateStr = dataPoint.date
          ? new Date(dataPoint.date as number).toLocaleDateString()
          : "—";

        if (entries.length > 0) {
          const values = entries
            .map(([key, value]) => `${chalk.cyan(key)}: ${formatValue(value)}`)
            .join(", ");
          console.log(`  ${chalk.gray(dateStr)}: ${values}`);
        }
      }
    }

    console.log();
    console.log(chalk.gray("Available presets: " + Object.keys(METRIC_PRESETS).join(", ")));
    console.log(
      chalk.gray(
        `Use ${chalk.cyan("langwatch analytics query --metric <preset> -f json")} for raw data`,
      ),
    );
  } catch (error) {
    spinner.fail();
    if (error instanceof AnalyticsApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error querying analytics: ${formatApiErrorMessage({ error })}`,
        ),
      );
    }
    process.exit(1);
  }
};

function formatValue(value: unknown): string {
  if (typeof value === "number") {
    return value % 1 === 0 ? value.toLocaleString() : value.toFixed(4);
  }
  return String(value);
}
