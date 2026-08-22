import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import {
  ExperimentsApiService,
  type ExperimentVersionSummary,
} from "@/client-sdk/services/experiments/experiments-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { formatTable, formatRelativeTime } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";

export interface ExperimentVersionsOptions {
  limit?: string;
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
    const parsed = options.limit ? parseInt(options.limit, 10) : DEFAULT_LIMIT;
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
    return Math.min(parsed, MAX_PAGE_SIZE);
  })();

  const service = new ExperimentsApiService();
  const spinner = createSpinner(`Fetching versions of "${slug}"...`).start();

  try {
    const result = await service.listVersions({ slug, limit });
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
              `More versions below v${result.nextCursor}. Raise ${chalk.cyan("--limit")} to see them.`,
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
