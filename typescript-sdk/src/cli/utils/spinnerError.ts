import chalk from "chalk";
import type { Ora } from "ora";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";

/**
 * Collapses the `spinner.fail(); console.error(...)` pattern into a single
 * call. A bare `spinner.fail()` leaves the spinner's starting text
 * ("Fetching X...") on screen with a red X, then the real error prints
 * on a separate line — two lines that look unrelated.
 *
 * Also avoids double-prefixing when the caught error is already a service
 * layer `*ApiError` whose message starts with "Failed to …" (these come
 * from `formatApiErrorForOperation`).
 */
export function failSpinner({
  spinner,
  error,
  action,
}: {
  spinner: Ora;
  error: unknown;
  /** Short description of what was being done, e.g. "fetch agents". */
  action: string;
}): void {
  const isApiError =
    error instanceof Error &&
    typeof error.name === "string" &&
    error.name.endsWith("ApiError") &&
    typeof error.message === "string" &&
    /^failed to /i.test(error.message);
  const message = isApiError
    ? (error as Error).message
    : `Failed to ${action}: ${formatApiErrorMessage({ error })}`;
  spinner.fail(chalk.red(message));
}
