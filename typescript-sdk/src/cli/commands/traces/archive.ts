import chalk from "chalk";
import ora from "ora";
import {
  TracesApiService,
  TracesApiError,
} from "@/client-sdk/services/traces/traces-api.service";
import { checkApiKey } from "../../utils/apiKey";

export const archiveTracesCommand = async (
  traceIds: string[],
  _options: Record<string, unknown> = {},
): Promise<void> => {
  checkApiKey();

  if (traceIds.length === 0) {
    console.error(chalk.red("Error: at least one trace ID is required"));
    process.exit(1);
  }

  const service = new TracesApiService();
  const label =
    traceIds.length === 1
      ? `trace "${traceIds[0]}"`
      : `${traceIds.length} traces`;
  const spinner = ora(`Archiving ${label}...`).start();

  try {
    const result = await service.archive(traceIds);
    spinner.succeed(
      `Dispatched archive command for ${result.dispatched} trace${
        result.dispatched === 1 ? "" : "s"
      }`,
    );
    console.log();
    console.log(
      chalk.gray(
        "Archive commands run asynchronously through the event-sourcing pipeline.",
      ),
    );
    console.log(
      chalk.gray(
        "Archived traces are excluded from queries; underlying data is retained.",
      ),
    );
  } catch (error) {
    spinner.fail();
    if (error instanceof TracesApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error archiving traces: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};
