import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import {
  ExperimentsApiService,
  type ExperimentVersionSummary,
} from "@/client-sdk/services/experiments/experiments-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { formatTable, formatRelativeTime } from "../../utils/formatting";
import { parsePositiveIntOrNull } from "../../utils/positiveInt";
import type { CommandResult } from "../../utils/output";

export interface ExperimentVersionsOptions {
  limit?: string;
  cursor?: string;
}

const DEFAULT_LIMIT = 50;
const MAX_PAGE_SIZE = 100;

/** How the history names whoever wrote a version. */
const authorOf = (version: ExperimentVersionSummary): string => {
  if (version.authorLabel === "langy") return "Langy";
  if (version.authorLabel === "api") return "API";
  return "User";
};

export const experimentVersionsCommand = async (
  slug: string,
  options: ExperimentVersionsOptions = {},
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const limit = (() => {
    const parsed = options.limit
      ? parsePositiveIntOrNull(options.limit)
      : DEFAULT_LIMIT;
    if (parsed === null) return DEFAULT_LIMIT;
    return Math.min(parsed, MAX_PAGE_SIZE);
  })();

  const cursor = (() => {
    if (options.cursor === undefined) return undefined;
    const parsed = parsePositiveIntOrNull(options.cursor);
    if (parsed !== null) return parsed;
    // Dropping an unreadable cursor would silently serve page one again, so a
    // caller walking the history would loop over the same versions forever.
    console.error(
      `--cursor takes the nextCursor of the previous page, like 42. Got "${options.cursor}".`,
    );
    process.exit(1);
  })();

  const service = new ExperimentsApiService();
  const spinner = createSpinner(`Fetching versions of "${slug}"...`).start();

  try {
    const result = await service.listVersions({
      slug,
      limit,
      ...(cursor !== undefined ? { cursor } : {}),
    });
    spinner.succeed(
      `Found ${result.versions.length} version${result.versions.length === 1 ? "" : "s"}`,
    );

    return {
      data: result,
      table: () => {
        if (result.versions.length === 0) {
          console.log();
          console.log(chalk.gray("This experiment has no saved versions yet."));
          return;
        }

        console.log();

        formatTable({
          data: result.versions.map((version) => ({
            Version: `v${version.version}`,
            Author: authorOf(version),
            Message: version.commitMessage ?? chalk.gray("—"),
            Saved: formatRelativeTime(version.createdAt),
          })),
          headers: ["Version", "Author", "Message", "Saved"],
          colorMap: {
            Version: chalk.cyan,
            Author: chalk.green,
          },
        });

        if (result.nextCursor !== null) {
          console.log();
          console.log(
            chalk.gray(
              `More versions below v${result.nextCursor}. Next page: ${chalk.cyan(
                `langwatch experiment versions ${slug} --cursor ${result.nextCursor}`,
              )}`,
            ),
          );
        }

        console.log();
        console.log(
          chalk.gray(
            `Use ${chalk.cyan(`langwatch experiment restore ${slug} <version>`)} to bring one back.`,
          ),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch experiment versions" });
    process.exit(1);
  }
};
