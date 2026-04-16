import chalk from "chalk";
import ora from "ora";
import {
  AnnotationsApiService,
  AnnotationsApiError,
} from "@/client-sdk/services/annotations/annotations-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable, formatRelativeTime } from "../../utils/formatting";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";

export const listAnnotationsCommand = async (options: {
  traceId?: string;
  format?: string;
}): Promise<void> => {
  checkApiKey();

  const service = new AnnotationsApiService();
  const label = options.traceId
    ? `Fetching annotations for trace "${options.traceId}"...`
    : "Fetching annotations...";
  const spinner = ora(label).start();

  try {
    const result = options.traceId
      ? await service.getByTrace(options.traceId)
      : await service.getAll();

    // Handle both array and {data: [...]} response shapes
    const annotations = Array.isArray(result)
      ? result
      : (result as unknown as { data: typeof result }).data ?? [];

    spinner.succeed(
      `Found ${annotations.length} annotation${annotations.length !== 1 ? "s" : ""}`,
    );

    if (options.format === "json") {
      console.log(JSON.stringify(annotations, null, 2));
      return;
    }

    if (annotations.length === 0) {
      console.log();
      console.log(chalk.gray("No annotations found."));
      console.log(chalk.gray("Create one with:"));
      console.log(
        chalk.cyan(
          '  langwatch annotation create <traceId> --comment "Great response!"',
        ),
      );
      return;
    }

    console.log();

    const tableData = annotations.map((a) => ({
      ID: a.id ?? "—",
      "Trace ID": a.traceId ? a.traceId.substring(0, 20) : "—",
      Comment: truncate(a.comment ?? "—", 40),
      Rating: a.isThumbsUp === true ? "👍" : a.isThumbsUp === false ? "👎" : "—",
      Created: a.createdAt ? formatRelativeTime(a.createdAt) : "—",
    }));

    formatTable({
      data: tableData,
      headers: ["ID", "Trace ID", "Comment", "Rating", "Created"],
      colorMap: {
        ID: chalk.green,
        "Trace ID": chalk.cyan,
      },
    });

    console.log();
    console.log(
      chalk.gray(
        `Use ${chalk.cyan("langwatch annotation get <id>")} to view full details`,
      ),
    );
  } catch (error) {
    spinner.fail();
    if (error instanceof AnnotationsApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error fetching annotations: ${formatApiErrorMessage({ error })}`,
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
