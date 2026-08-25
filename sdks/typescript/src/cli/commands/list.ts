import chalk from "chalk";
import { createSpinner } from "../utils/spinner";
import { PromptsApiService, PromptsError } from "@/client-sdk/services/prompts";
import { resolveCredentials } from "../utils/apiKey";
import { formatTable, formatRelativeTime } from "../utils/formatting";
import { parsePositiveIntOrNull } from "../utils/positiveInt";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";
import { failSpinner } from "../utils/spinnerError";
import type { CommandResult } from "../utils/output";

export interface PromptListOptions {
  /** How many prompts to return. All of them when absent. */
  limit?: string;
}

/**
 * `--limit` is the paging flag every other list command in this CLI takes, so a
 * caller that has used one of those reaches for it here too.
 *
 * A value that is not a positive whole number ends the command rather than
 * being dropped: dropping it lists everything, and the caller reads the whole
 * server as the page they asked for. This is what `experiment versions` does
 * with the same flag.
 */
const resolveLimit = (raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined;
  const parsed = parsePositiveIntOrNull(raw);
  if (parsed === null) {
    console.error(
      `--limit takes a whole number of prompts, 1 or more. Got "${raw}".`,
    );
    process.exit(1);
  }
  return parsed;
};

export const listCommand = async (
  options: PromptListOptions = {},
): Promise<CommandResult | void> => {
  try {
    // Check API key before doing anything else
    await resolveCredentials();

    // Get prompts API service
    const promptsApiService = new PromptsApiService();

    const spinner = createSpinner("Fetching prompts from server...").start();

    try {
      // Fetch all prompts
      const fetched = await promptsApiService.getAll();
      const limit = resolveLimit(options.limit);
      const allPrompts =
        limit === undefined ? fetched : fetched.slice(0, limit);
      const prompts = allPrompts.filter((prompt) => prompt.version);
      const draftPrompts = allPrompts.filter((prompt) => !prompt.version);
      const cut = allPrompts.length < fetched.length;

      spinner.succeed(
        `Found ${prompts.length} published prompt${
          prompts.length !== 1 ? "s" : ""
        } ` +
          chalk.gray(
            `(+${draftPrompts.length} draft${
              draftPrompts.length !== 1 ? "s" : ""
            })`,
          ),
      );

      return {
        data: allPrompts,
        table: () => {
          if (prompts.length === 0) {
            console.log();
            if (cut) {
              // The cap ran before the published filter, so the page can hold
              // only drafts while the server holds published prompts too.
              // Saying "none on the server" here would be false.
              console.log(
                chalk.gray(
                  `No published prompts in the first ${allPrompts.length} of ${fetched.length}. Raise or drop --limit to see the rest.`,
                ),
              );
              console.log();
              return;
            }
            console.log(chalk.gray("No prompts found on the server."));
            console.log(chalk.gray("Create your first prompt with:"));
            console.log(chalk.cyan("  langwatch prompt init"));
            return;
          }

          console.log();

          // Format prompts for table display
          const tableData = prompts.map((prompt) => ({
            Name: prompt.handle ?? `${prompt.name} ` + chalk.gray(`(${prompt.id})`),
            Version: prompt.version ? `${prompt.version}` : "N/A",
            Model: prompt.model ?? "N/A",
            Tags:
              prompt.tags && prompt.tags.length > 0
                ? prompt.tags.map((t) => t.name).join(", ")
                : chalk.gray("—"),
            Updated: formatRelativeTime(prompt.updatedAt),
          }));

          // Display table
          formatTable({
            data: tableData,
            headers: ["Name", "Version", "Model", "Tags", "Updated"],
            colorMap: {
              Name: chalk.cyan,
              Version: chalk.green,
              Model: chalk.yellow,
              Tags: chalk.magenta,
            },
            emptyMessage: "No prompts found",
          });

          if (cut) {
            console.log();
            console.log(
              chalk.gray(
                `Showing ${allPrompts.length} of ${fetched.length}. Raise or drop --limit to see the rest.`,
              ),
            );
          }

          console.log();
          console.log(
            chalk.gray(
              `Use ${chalk.cyan(
                "langwatch prompt add <name>",
              )} to add a prompt to your project`,
            ),
          );
        },
      };
    } catch (error) {
      failSpinner({ spinner, error, action: "fetch prompts" });
      process.exit(1);
    }
  } catch (error) {
    if (error instanceof PromptsError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Unexpected error: ${
            formatApiErrorMessage({ error })
          }`,
        ),
      );
    }
    process.exit(1);
  }
};
