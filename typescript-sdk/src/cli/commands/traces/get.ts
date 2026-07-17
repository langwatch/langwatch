import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { TracesApiService } from "@/client-sdk/services/traces/traces-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export const getTraceCommand = async (
  traceId: string,
  options: { format?: string },
): Promise<void> => {
  checkApiKey();

  const service = new TracesApiService();
  const spinner = createSpinner(`Fetching trace "${traceId}"...`).start();

  try {
    const format = (options.format as "digest" | "json") ?? "digest";
    const trace = await service.get(traceId, { format });

    spinner.succeed(`Found trace "${traceId}"`);

    if (format === "json") {
      console.log(JSON.stringify(trace, null, 2));
    } else {
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
    }
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch trace", format: options?.format });
    process.exit(1);
  }
};
