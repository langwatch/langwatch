import chalk from "chalk";

import { TracesApiService } from "@/client-sdk/services/traces/traces-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import { printResult, resolveOutputOptions, type RawOutputFlags } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

/**
 * Waits between lookups of a trace the platform says may still be arriving
 * (`trace_not_found` marked retryable): a just-sent trace lands in seconds.
 */
export const TRACE_GET_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

const isStillArriving = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: unknown }).code === "trace_not_found" &&
  (error as { retryable?: unknown }).retryable === true;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** How the platform found the trace, when it was not the exact id in this project. */
function foundNote(trace: unknown): string {
  if (typeof trace !== "object" || trace === null) return "";
  const notes: string[] = [];
  const record = trace as Record<string, unknown>;
  if (typeof record.resolved_from === "string") {
    notes.push(`resolved from a ${record.resolved_from.replace(/_/g, " ")}`);
  }
  const project = record.project as { slug?: unknown } | undefined;
  if (typeof project?.slug === "string") notes.push(`in project "${project.slug}"`);
  if (record.still_ingesting === true) {
    notes.push(
      "still being stored, so input, output and cost may be missing; get it again shortly",
    );
  }
  return notes.length > 0 ? ` (${notes.join("; ")})` : "";
}

export const getTraceCommand = async (
  traceId: string,
  options: RawOutputFlags & { project?: string },
): Promise<void> => {
  await resolveCredentials({ project: options.project });

  const service = new TracesApiService();
  const spinner = createSpinner(`Fetching trace "${traceId}"...`).start();

  let trace: Awaited<ReturnType<TracesApiService["get"]>>;
  try {
    // The CLI's output format and the API's response shape used to share one
    // flag (`--format digest|json`). Now the output contract decides: any
    // machine format needs the rich "json" response to render from; the human
    // default keeps the AI-readable "digest" text.
    const apiFormat = resolveOutputOptions(options).format === "table" ? "digest" : "json";
    trace = await getWithRetries(() => service.get(traceId, { format: apiFormat }));

    spinner.succeed(`Found trace "${traceId}"${foundNote(trace)}`);
  } catch (error) {
    // No explicit `format`: see traces/search.ts — the preAction hook covers
    // every spelling; the `-f` commander default ("digest") must not override it.
    failSpinner({ spinner, error, action: "fetch trace" });
    process.exit(1);
  }

  // Rendering stays OUTSIDE the fetch try: a printResult rejection (invalid
  // --jq) is a rendering failure, not a fetch failure.
  await printResult(trace, {
    ...options,
    table: () => {
      // Digest format - print as-is since it's already AI-readable text
      console.log();
      if (typeof trace === "string") {
        console.log(trace);
      } else {
        if (trace.platformUrl) {
          console.log(`  ${chalk.bold("View:")}  ${chalk.underline(trace.platformUrl)}`);
          console.log();
        }
        console.log(JSON.stringify(trace, null, 2));
      }
    },
  });
};

async function getWithRetries<T>(get: () => Promise<T>): Promise<T> {
  for (const delayMs of TRACE_GET_RETRY_DELAYS_MS) {
    try {
      return await get();
    } catch (error) {
      if (!isStillArriving(error)) throw error;
      await sleep(delayMs);
    }
  }
  return get();
}
