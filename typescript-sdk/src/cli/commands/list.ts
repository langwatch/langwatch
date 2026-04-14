import chalk from "chalk";
import ora from "ora";
import { PromptsApiService, PromptsError } from "@/client-sdk/services/prompts";
import { checkApiKey } from "../utils/apiKey";
import { formatTable, formatRelativeTime } from "../utils/formatting";

export const listCommand = async (options?: { format?: string }): Promise<void> => {
  try {
    // Check API key before doing anything else
    checkApiKey();

    // Get prompts API service
    const promptsApiService = new PromptsApiService();

    const spinner = ora("Fetching prompts from server...").start();

    try {
      // Fetch all prompts
      const allPrompts = await promptsApiService.getAll();
      const prompts = allPrompts.filter((prompt) => prompt.version);
      const draftPrompts = allPrompts.filter((prompt) => !prompt.version);

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

      if (options?.format === "json") {
        console.log(JSON.stringify(allPrompts, null, 2));
        return;
      }

      if (prompts.length === 0) {
        console.log();
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
        Updated: formatRelativeTime(prompt.updatedAt),
      }));

      // Display table
      formatTable({
        data: tableData,
        headers: ["Name", "Version", "Model", "Updated"],
        colorMap: {
          Name: chalk.cyan,
          Version: chalk.green,
          Model: chalk.yellow,
        },
        emptyMessage: "No prompts found",
      });

      console.log();
      console.log(
        chalk.gray(
          `Use ${chalk.cyan(
            "langwatch prompt add <name>",
          )} to add a prompt to your project`,
        ),
      );
    } catch (error) {
      spinner.fail();
      if (error instanceof PromptsError) {
        console.error(chalk.red(`Error: ${error.message}`));
      } else {
        console.error(
          chalk.red(
            `Error fetching prompts: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          ),
        );
      }
      process.exit(1);
    }
  } catch (error) {
    if (error instanceof PromptsError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Unexpected error: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        ),
      );
    }
    process.exit(1);
  }
};
