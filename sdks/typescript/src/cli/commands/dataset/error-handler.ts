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
    // Keep the type as a handled error. Wrapped in a plain Error it would be
    // read as `network_error` at status 0, and a wrong slug would tell the
    // caller to check their network connection.
    failSpinner({
      spinner,
      error: {
        isLangWatchHandledError: true,
        code: "not_found",
        message: `Not found: ${error.message}`,
        httpStatus: 404,
      },
      action: context,
    });
  } else if (error instanceof DatasetPlanLimitError) {
    failSpinner({
      spinner,
      error: {
        isLangWatchHandledError: true,
        code: "plan_limit_reached",
        message: `Plan limit reached: ${error.message}`,
        httpStatus: 403,
        meta: {
          limitType: error.limitType,
          ...(error.current !== undefined ? { current: error.current } : {}),
          ...(error.max !== undefined ? { max: error.max } : {}),
        },
      },
      action: context,
    });
    if (error.current !== undefined && error.max !== undefined) {
      console.error(chalk.gray(`  Current ${error.limitType}: ${error.current} / ${error.max}`));
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
