import chalk from "chalk";
import ora from "ora";
import { PromptService, PromptsError } from "../../prompt/service";
import { checkApiKey } from "../utils/apiKey";

// Helper to strip ANSI codes for length calculation
const stripAnsi = (str: string): string => {
  return str.replace(/\u001b\[[0-9;]*m/g, '');
};

// Simple table formatting helper
const formatTable = (
  data: Array<Record<string, string>>,
  headers: string[],
): void => {
  if (data.length === 0) {
    console.log(chalk.gray("No prompts found"));
    return;
  }

  // Calculate column widths (strip ANSI codes for accurate length calculation)
  const colWidths: Record<string, number> = {};
  headers.forEach((header) => {
    colWidths[header] = Math.max(
      header.length,
      ...data.map((row) => stripAnsi(row[header] || "").length),
    );
  });

  // Print header
  const headerRow = headers
    .map((header) => chalk.bold(header.padEnd(colWidths[header]!)))
    .join("  ");
  console.log(headerRow);

  // Print separator
  const separator = headers
    .map((header) => "─".repeat(colWidths[header]!))
    .join("  ");
  console.log(chalk.gray(separator));

  // Print data rows
  data.forEach((row) => {
    const dataRow = headers
      .map((header) => {
        const value = row[header] || "";
        const strippedLength = stripAnsi(value).length;
        const paddingNeeded = colWidths[header]! - strippedLength;
        const paddedValue = value + " ".repeat(Math.max(0, paddingNeeded));

        // Color coding
        if (header === "Name") {
          return chalk.cyan(paddedValue);
        } else if (header === "Version") {
          return chalk.green(paddedValue);
        } else if (header === "Model") {
          return chalk.yellow(paddedValue);
        } else {
          return chalk.gray(paddedValue);
        }
      })
      .join("  ");
    console.log(dataRow);
  });
};

const formatRelativeTime = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) return `${years}y ago`;
  if (months > 0) return `${months}mo ago`;
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
};

export const listCommand = async (): Promise<void> => {
  try {
    // Check API key before doing anything else
    checkApiKey();

    // Get prompt service
    const promptService = PromptService.getInstance();

    const spinner = ora("Fetching prompts from server...").start();

    try {
      // Fetch all prompts
      const prompts = await promptService.getAll();

      spinner.succeed(
        `Found ${prompts.length} prompt${prompts.length !== 1 ? "s" : ""}`,
      );

      if (prompts.length === 0) {
        console.log();
        console.log(chalk.gray("No prompts found on the server."));
        console.log(chalk.gray("Create your first prompt with:"));
        console.log(chalk.cyan("  langwatch prompt init"));
        return;
      }

      console.log();

      // Format prompts for table display
      const tableData = prompts
        .filter((prompt) => prompt.version)
        .map((prompt) => ({
          Name:
            prompt.handle || `${prompt.name} ` + chalk.gray(`(${prompt.id})`),
          Version: prompt.version ? `${prompt.version}` : "N/A",
          Model: prompt.model || "N/A",
          Updated: formatRelativeTime(prompt.updatedAt),
        }));

      // Display table
      formatTable(tableData, ["Name", "Version", "Model", "Updated"]);

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
