import chalk from "chalk";
import { DatasetNotFoundError, DatasetApiError } from "@/client-sdk/services/datasets/errors";

/**
 * Centralized error handler for all dataset CLI commands.
 * Maps known error types to user-friendly messages and exits with code 1.
 *
 * @param error - The caught error
 * @param context - Human-readable context (e.g. "creating dataset", "uploading file")
 */
export function handleDatasetCommandError(error: unknown, context: string): never {
  if (error instanceof DatasetNotFoundError) {
    console.error(chalk.red(`Not found: ${error.message}`));
  } else if (error instanceof DatasetApiError) {
    console.error(chalk.red(`Error: ${error.message}`));
  } else {
    console.error(chalk.red(`Error ${context}: ${error instanceof Error ? error.message : "Unknown error"}`));
  }
  process.exit(1);
}
