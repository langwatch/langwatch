import chalk from "chalk";
import type { Ora } from "ora";
import {
  DatasetApiError,
  DatasetNotFoundError,
  DatasetPlanLimitError,
} from "@/client-sdk/services/datasets/errors";
import { failSpinner } from "../../utils/spinnerError";

/**
 * Centralized error handler for all dataset CLI commands.
 * Every branch funnels through failSpinner, so a machine caller always gets
 * the structured `{ ok: false }` document and a person gets one fail line
 * (plus an optional detail line for plan limits) — never two disconnected
 * lines. Exits with code 1.
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
    // The "Not found:" prefix stays inside the message so the failSpinner
    // headline keeps it: "Failed to <context>: Not found: <detail>".
    failSpinner({
      spinner,
      error: new Error(`Not found: ${error.message}`),
      action: context,
    });
  } else if (error instanceof DatasetPlanLimitError) {
    failSpinner({
      spinner,
      error: new Error(`Plan limit reached: ${error.message}`),
      action: context,
    });
    if (error.current !== undefined && error.max !== undefined) {
      console.error(
        chalk.gray(
          `  Current ${error.limitType}: ${error.current} / ${error.max}`,
        ),
      );
    }
  } else if (error instanceof DatasetApiError) {
    // DatasetApiError.message is already built with formatApiErrorForOperation
    // ("Failed to <op>: <detail>"), so forward it as-is via failSpinner to keep
    // the double-prefix guard and single-line rendering consistent.
    failSpinner({ spinner, error, action: context });
  } else {
    failSpinner({ spinner, error, action: context });
  }
  process.exit(1);
}
