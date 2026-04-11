import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { createDatasetService } from "./service-factory";
import { handleDatasetCommandError } from "./error-handler";

/**
 * Reads all data from stdin as a string.
 */
const readStdin = (): Promise<string> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    process.stdin.on("error", reject);
  });
};

/**
 * Parses a JSON string into an array of record entries.
 * Validates that the input is valid JSON and is an array.
 *
 * @param jsonStr - The raw JSON string
 * @returns Parsed array of record objects
 * @throws Error if the JSON is invalid or not an array
 */
export const parseRecordsJson = (jsonStr: string): Record<string, unknown>[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error("Invalid JSON: could not parse input.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Invalid input: expected a JSON array of records.");
  }

  return parsed as Record<string, unknown>[];
};

/**
 * Adds records to a dataset from inline JSON or stdin.
 */
export const recordsAddCommand = async (
  slugOrId: string,
  options: { json?: string; stdin?: boolean },
): Promise<void> => {
  checkApiKey();

  if (!options.json && !options.stdin) {
    console.error(
      chalk.red("Error: One of --json or --stdin is required."),
    );
    process.exit(1);
  }

  let entries: Record<string, unknown>[];
  try {
    const jsonStr = options.stdin ? await readStdin() : options.json!;
    entries = parseRecordsJson(jsonStr);
  } catch (error) {
    console.error(
      chalk.red(error instanceof Error ? error.message : "Invalid JSON input"),
    );
    process.exit(1);
  }

  if (entries.length === 0) {
    console.error(chalk.red("Error: No records provided. The JSON array is empty."));
    process.exit(1);
  }

  const service = createDatasetService();
  const spinner = ora(`Adding ${entries.length} record${entries.length !== 1 ? "s" : ""} to "${slugOrId}"...`).start();

  try {
    const result = await service.createRecords(slugOrId, entries);
    const created = result.data;

    spinner.succeed(
      `Added ${created.length} record${created.length !== 1 ? "s" : ""} to "${chalk.cyan(slugOrId)}"`,
    );
    console.log();
    created.forEach((record) => {
      console.log(`  ${chalk.bold("ID:")} ${record.id}`);
    });
  } catch (error) {
    spinner.fail("Failed to add records");
    handleDatasetCommandError(error, "adding records");
  }
};
