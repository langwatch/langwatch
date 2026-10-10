import { readFileSync } from "fs";

import type {
  DashboardWidgetDefinitionInput,
  DashboardWidgetQueryInput,
} from "@/client-sdk/services/dashboard-widgets/dashboard-widgets-api.service";

/** The flags `dashboard-widget create` and `update` share for the definition. */
export interface DefinitionFlags {
  code?: string;
  codeFile?: string;
  queriesFile?: string;
}

/** Thrown for input the CLI can refuse before any request is made. */
export class WidgetInputError extends Error {}

/**
 * Resolves definition flags to { code, queries }, refusing partial
 * definitions (both source and queries required together).
 */
export const resolveDefinitionInput = (
  flags: DefinitionFlags,
): DashboardWidgetDefinitionInput | undefined => {
  const hasCodeFlag = flags.code !== undefined || flags.codeFile !== undefined;
  const hasQueriesFlag = flags.queriesFile !== undefined;
  if (!hasCodeFlag && !hasQueriesFlag) return undefined;

  if (flags.code !== undefined && flags.codeFile !== undefined) {
    throw new WidgetInputError("Pass either --code or --code-file, not both");
  }
  if (!hasCodeFlag || !hasQueriesFlag) {
    throw new WidgetInputError(
      "A definition needs both its source and its queries: pass --code / --code-file together with --queries-file",
    );
  }

  const code = flags.code ?? readTextFile(flags.codeFile!, "code");
  if (code.trim().length === 0) {
    throw new WidgetInputError("A widget's code must not be empty");
  }

  return { code, queries: readQueriesFile(flags.queriesFile!) };
};

const readTextFile = (path: string, label: string): string => {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    throw new WidgetInputError(`Could not read ${label} file: ${path}`);
  }
};

/**
 * Reads the queries file: a JSON array of `{ name, sql, parameters? }`. Only
 * refuses input that isn't an array of objects -- the platform's versioned
 * schema checks the rest on save.
 */
const readQueriesFile = (path: string): DashboardWidgetQueryInput[] => {
  const raw = readTextFile(path, "queries");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new WidgetInputError(`Queries file is not valid JSON: ${path}`);
  }
  const shapeError = `Queries file must be a JSON array of { name, sql, parameters? }: ${path}`;
  if (!Array.isArray(parsed)) {
    throw new WidgetInputError(shapeError);
  }
  if (!parsed.every((entry) => typeof entry === "object" && entry !== null)) {
    throw new WidgetInputError(shapeError);
  }
  return parsed as DashboardWidgetQueryInput[];
};
