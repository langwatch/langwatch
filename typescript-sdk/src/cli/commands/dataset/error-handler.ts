import chalk from "chalk";
import type { Ora } from "ora";
import {
  DatasetApiError,
  DatasetNotFoundError,
  DatasetPlanLimitError,
} from "@/client-sdk/services/datasets/errors";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";

/**
 * Centralized error handler for all dataset CLI commands.
 * Maps known error types to a single spinner-fail line (plus an optional
 * detail line for plan limits) and exits with code 1.
 *
 * @param spinner - The ora spinner to fail. The spinner's message is the
 *   only top-level error line rendered — we never emit a separate
 *   `console.error` that would produce two disconnected lines.
 * @param error - The caught error
 * @param context - Human-readable action description (e.g. "create dataset",
 *   "upload records"). Used as a fallback prefix when the error doesn't
 *   already carry one.
 */
export function handleDatasetCommandError({
  spinner,
  error,
  context,
}: {
  spinner: Ora;
  error: unknown;
  context: string;
}): never {
  if (error instanceof DatasetNotFoundError) {
    spinner.fail(chalk.red(`Not found: ${error.message}`));
  } else if (error instanceof DatasetPlanLimitError) {
    spinner.fail(chalk.red(`Plan limit reached: ${error.message}`));
    if (error.current !== undefined && error.max !== undefined) {
      console.error(
        chalk.gray(
          `  Current ${error.limitType}: ${error.current} / ${error.max}`,
        ),
      );
    }
  } else if (error instanceof DatasetApiError) {
    spinner.fail(chalk.red(error.message));
  } else {
    spinner.fail(
      chalk.red(`Failed to ${context}: ${formatApiErrorMessage({ error })}`),
    );
  }
  process.exit(1);
}
