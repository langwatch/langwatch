import chalk from "chalk";
import ora from "ora";
import fs from "fs";
import { apiRequest } from "../../utils/apiClient";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export const exportTracesCommand = async (options: {
  startDate?: string;
  endDate?: string;
  query?: string;
  format?: string;
  output?: string;
  limit?: string;
}): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const format = options.format ?? "jsonl";
  if (format !== "csv" && format !== "jsonl" && format !== "json") {
    console.error(chalk.red("Error: --format must be csv, jsonl, or json"));
    process.exit(1);
  }

  const now = Date.now();
  const startDate = options.startDate
    ? new Date(options.startDate).getTime()
    : now - 7 * 24 * 60 * 60 * 1000; // 7 days ago
  const endDate = options.endDate
    ? new Date(options.endDate).getTime()
    : now;

  const limit = options.limit ? parseInt(options.limit, 10) : 1000;
  const spinner = ora(`Exporting traces (${format})...`).start();

  try {
    type ExportData = {
      traces: Array<{
        trace_id: string;
        input?: { value: string };
        output?: { value: string };
        timestamps?: { started_at?: number };
        metadata?: Record<string, unknown>;
        error?: Record<string, unknown>;
      }>;
      pagination?: { totalHits?: number };
    };
    let data: ExportData;
    try {
      data = (await apiRequest({
        method: "POST",
        path: "/api/traces/search",
        apiKey,
        endpoint,
        body: {
          query: options.query,
          startDate,
          endDate,
          pageSize: Math.min(limit, 100),
          format: "json",
        },
      })) as ExportData;
    } catch (httpError) {
      const message = httpError instanceof Error ? httpError.message : String(httpError);
      spinner.fail(`Export failed: ${message}`);
      process.exit(1);
    }

    const traces = data.traces;
    spinner.succeed(`Exported ${traces.length} trace${traces.length !== 1 ? "s" : ""}${data.pagination?.totalHits ? ` (${data.pagination.totalHits} total)` : ""}`);

    let output: string;

    if (format === "json") {
      output = JSON.stringify(traces, null, 2);
    } else if (format === "jsonl") {
      output = traces.map((t) => JSON.stringify(t)).join("\n") + "\n";
    } else {
      // CSV format
      const headers = ["trace_id", "input", "output", "started_at", "error"];
      const rows = traces.map((t) => [
        t.trace_id,
        csvEscape(t.input?.value ?? ""),
        csvEscape(t.output?.value ?? ""),
        t.timestamps?.started_at ? new Date(t.timestamps.started_at).toISOString() : "",
        t.error ? csvEscape(JSON.stringify(t.error)) : "",
      ]);
      output = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n") + "\n";
    }

    if (options.output) {
      fs.writeFileSync(options.output, output);
      console.log(chalk.green(`Written to ${options.output}`));
    } else {
      process.stdout.write(output);
    }
  } catch (error) {
    failSpinner({ spinner, error, action: "export traces" });
    process.exit(1);
  }
};

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
