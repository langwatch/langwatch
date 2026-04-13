import chalk from "chalk";
import ora from "ora";
import {
  TracesApiService,
  TracesApiError,
} from "@/client-sdk/services/traces/traces-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable, formatRelativeTime } from "../../utils/formatting";

export const searchTracesCommand = async (options: {
  query?: string;
  startDate?: string;
  endDate?: string;
  limit?: string;
  format?: string;
}): Promise<void> => {
  checkApiKey();

  const service = new TracesApiService();
  const spinner = ora("Searching traces...").start();

  try {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    const startDate = options.startDate
      ? new Date(options.startDate).getTime()
      : oneDayAgo;
    const endDate = options.endDate
      ? new Date(options.endDate).getTime()
      : now;
    const pageSize = options.limit ? parseInt(options.limit, 10) : 25;

    const result = await service.search({
      query: options.query,
      startDate,
      endDate,
      pageSize,
      format: (options.format as "digest" | "json") ?? "json",
    });

    const traces = result.traces as Array<Record<string, unknown>>;

    spinner.succeed(
      `Found ${result.pagination.totalHits} trace${result.pagination.totalHits !== 1 ? "s" : ""} (showing ${traces.length})`,
    );

    if (traces.length === 0) {
      console.log();
      console.log(chalk.gray("No traces found matching your criteria."));
      console.log(chalk.gray("Try widening your date range or search query."));
      return;
    }

    if (options.format === "json") {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log();

    const tableData = traces.map((trace) => {
      const traceId = (trace.traceId ?? trace.trace_id ?? trace.id ?? "—") as string;
      const input = truncate(String(trace.input ?? trace.ComputedInput ?? "—"), 60);
      const output = truncate(String(trace.output ?? trace.ComputedOutput ?? "—"), 40);
      const timestamps = trace.timestamps as Record<string, unknown> | undefined;
      const startedAt = timestamps?.started_at ?? trace.StartedAt ?? trace.startedAt;
      const timeStr = startedAt ? formatRelativeTime(new Date(startedAt as number).toISOString()) : "—";

      return {
        "Trace ID": traceId.substring(0, 20),
        Input: input,
        Output: output,
        Time: timeStr,
      };
    });

    formatTable({
      data: tableData,
      headers: ["Trace ID", "Input", "Output", "Time"],
      colorMap: {
        "Trace ID": chalk.green,
        Input: chalk.cyan,
      },
    });

    console.log();
    if (result.pagination.totalHits > traces.length) {
      console.log(
        chalk.gray(
          `Showing ${traces.length} of ${result.pagination.totalHits} total. Use --limit to see more.`,
        ),
      );
    }
    console.log(
      chalk.gray(
        `Use ${chalk.cyan("langwatch trace get <traceId>")} to view full details`,
      ),
    );
  } catch (error) {
    spinner.fail();
    if (error instanceof TracesApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error searching traces: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};

function truncate(str: string, maxLen: number): string {
  const cleaned = str.replace(/\n/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.substring(0, maxLen - 1) + "…";
}
