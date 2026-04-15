import chalk from "chalk";
import ora from "ora";
import {
  TracesApiService,
  TracesApiError,
} from "@/client-sdk/services/traces/traces-api.service";
import { checkApiKey } from "../../utils/apiKey";

export const getTraceCommand = async (
  traceId: string,
  options: { format?: string },
): Promise<void> => {
  checkApiKey();

  const service = new TracesApiService();
  const spinner = ora(`Fetching trace "${traceId}"...`).start();

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
        if ((trace as Record<string, unknown>).platformUrl) {
          console.log(`  ${chalk.bold("View:")}  ${chalk.underline((trace as Record<string, unknown>).platformUrl as string)}`);
          console.log();
        }
        console.log(JSON.stringify(trace, null, 2));
      }
    }
  } catch (error) {
    spinner.fail();
    if (error instanceof TracesApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error fetching trace: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};
