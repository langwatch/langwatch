import chalk from "chalk";
import type { Ora } from "ora";

import {
  DatasetApiError,
  DatasetNotFoundError,
  DatasetPlanLimitError,
} from "@/client-sdk/services/datasets/errors";

import { failSpinner } from "../../utils/spinnerError";

/**
 * Unified error line via failSpinner, never two disconnected lines.
 * @param spinner Ora spinner (message is the only error line)
 * @param error Caught error; @param context Action description
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
