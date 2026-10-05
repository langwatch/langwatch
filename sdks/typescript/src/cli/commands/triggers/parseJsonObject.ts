import type { Ora } from "ora";
import { commandValidationError } from "../../utils/errorOutput";
import { failSpinner } from "../../utils/spinnerError";

/** A flag value that must be a JSON OBJECT: `JSON.parse` alone accepts `5` and
 *  `[1]`, which would reach the API as `filters` or `actionParams`. */
export function parseJsonObject(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("not a JSON object");
  }
  return Object.fromEntries(Object.entries(parsed));
}

/** The JSON-object flags create and update share, parsed before the request so
 *  a non-JSON API response is never misread as a bad flag. */
export function parseJsonFlags({
  options,
  spinner,
  action,
}: {
  options: {
    filters?: string;
    actionParams?: string;
    graphAlert?: string;
    report?: string;
  };
  spinner: Ora;
  action: string;
}): Partial<Record<keyof typeof options, Record<string, unknown>>> {
  try {
    return {
      filters: options.filters ? parseJsonObject(options.filters) : undefined,
      actionParams: options.actionParams
        ? parseJsonObject(options.actionParams)
        : undefined,
      graphAlert: options.graphAlert
        ? parseJsonObject(options.graphAlert)
        : undefined,
      report: options.report ? parseJsonObject(options.report) : undefined,
    };
  } catch {
    failSpinner({
      spinner,
      error: commandValidationError(
        "--filters, --action-params, --graph-alert and --report must each be a JSON object",
      ),
      action,
    });
    process.exit(1);
  }
}
