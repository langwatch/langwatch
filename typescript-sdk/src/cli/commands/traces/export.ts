import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import fs from "fs";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";
import { createCommandEvents, type CommandEvents } from "../../telemetry/events";
import { buildAuthHeaders } from "@/internal/api/auth";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";

/** Rows are serialised in chunks so the progress bar moves as the file is built. */
const PROGRESS_CHUNK = 25;

interface ExportedTrace {
  trace_id: string;
  input?: { value: string };
  output?: { value: string };
  timestamps?: { started_at?: number };
  metadata?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

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
  const endpoint = resolveControlPlaneUrl();

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
  const spinner = createSpinner(`Exporting traces (${format})...`).start();
  const events = createCommandEvents({ resource: "trace", verb: "export" });

  try {
    events.started(`Exporting traces as ${format}…`);

    const response = await fetch(`${endpoint}/api/traces/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders({ apiKey }),
      },
      body: JSON.stringify({
        query: options.query,
        startDate,
        endDate,
        pageSize: Math.min(limit, 100),
        format: "json",
      }),
    });

    if (!response.ok) {
      // Read the body off a CLONE before `formatFetchError` consumes it, so the
      // event keeps the platform's real error kind instead of degrading to one
      // guessed from the status.
      const body: unknown = await response
        .clone()
        .json()
        .catch(() => undefined);

      const message = await formatFetchError(response);
      events.failed({
        error: Object.assign(new Error(message), {
          status: response.status,
          originalError: body,
        }),
        message: "Trace export failed",
      });
      await events.flush();

      spinner.fail(`Export failed: ${message}`);
      process.exit(1);
    }

    const data = await response.json() as {
      traces: ExportedTrace[];
      pagination?: { totalHits?: number };
    };

    const traces = data.traces;
    const matched = data.pagination?.totalHits ?? traces.length;

    events.count({
      count: matched,
      total: matched,
      message: `${matched.toLocaleString()} trace${matched === 1 ? "" : "s"} to export`,
    });

    spinner.succeed(`Exported ${traces.length} trace${traces.length !== 1 ? "s" : ""}${data.pagination?.totalHits ? ` (${data.pagination.totalHits} total)` : ""}`);

    // Serialising each trace is real per-row work, so this progress is genuinely
    // the file being built — not a bar invented for the sake of having one.
    const output = serialise({ events, traces, format, matched });

    if (options.output) {
      fs.writeFileSync(options.output, output);
      console.log(chalk.green(`Written to ${options.output}`));
    } else {
      process.stdout.write(output);
    }

    events.completed({
      count: traces.length,
      total: matched,
      message: `Exported ${traces.length} trace${traces.length === 1 ? "" : "s"} as ${format}`,
    });
  } catch (error) {
    events.failed({ error, message: "Trace export failed" });
    await events.flush();
    failSpinner({ spinner, error, action: "export traces", format: options?.format });
    process.exit(1);
  } finally {
    await events.flush();
  }
};

/** Build the export document, reporting progress as the rows are written. */
const serialise = ({
  events,
  traces,
  format,
  matched,
}: {
  events: CommandEvents;
  traces: ExportedTrace[];
  format: string;
  matched: number;
}): string => {
  const lines: string[] = [];

  for (let done = 0; done < traces.length; done += PROGRESS_CHUNK) {
    const to = Math.min(done + PROGRESS_CHUNK, traces.length);

    for (const trace of traces.slice(done, to)) {
      lines.push(serialiseTrace({ trace, format }));
    }

    events.progress({
      progress: to / traces.length,
      count: to,
      total: traces.length,
      message: `Wrote ${to} of ${traces.length} trace${traces.length === 1 ? "" : "s"} (${matched.toLocaleString()} matched)`,
    });
  }

  if (format === "json") return JSON.stringify(traces, null, 2);
  if (format === "jsonl") return lines.join("\n") + "\n";

  const headers = ["trace_id", "input", "output", "started_at", "error"];
  return [headers.join(","), ...lines].join("\n") + "\n";
};

const serialiseTrace = ({
  trace,
  format,
}: {
  trace: ExportedTrace;
  format: string;
}): string => {
  if (format !== "csv") return JSON.stringify(trace);

  return [
    trace.trace_id,
    csvEscape(trace.input?.value ?? ""),
    csvEscape(trace.output?.value ?? ""),
    trace.timestamps?.started_at
      ? new Date(trace.timestamps.started_at).toISOString()
      : "",
    trace.error ? csvEscape(JSON.stringify(trace.error)) : "",
  ].join(",");
};

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
