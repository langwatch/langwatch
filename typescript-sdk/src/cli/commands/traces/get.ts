import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { TracesApiService } from "@/client-sdk/services/traces/traces-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import {
  printResult,
  resolveOutputOptions,
  type RawOutputFlags,
} from "../../utils/output";

export const getTraceCommand = async (
  traceId: string,
  options: RawOutputFlags,
): Promise<void> => {
  checkApiKey();

  const service = new TracesApiService();
  const spinner = createSpinner(`Fetching trace "${traceId}"...`).start();

  try {
    // The CLI's output format and the API's response shape used to share one
    // flag (`--format digest|json`). Now the output contract decides: any
    // machine format needs the rich "json" response to render from; the human
    // default keeps the AI-readable "digest" text.
    const apiFormat =
      resolveOutputOptions(options).format === "table" ? "digest" : "json";
    const trace = await service.get(traceId, { format: apiFormat });

    spinner.succeed(`Found trace "${traceId}"`);

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
  } catch (error) {
    // No explicit `format`: see traces/search.ts — the preAction hook covers
    // every spelling; the `-f` commander default ("digest") must not override it.
    failSpinner({ spinner, error, action: "fetch trace" });
    process.exit(1);
  }
};
