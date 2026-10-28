import { readFileSync } from "fs";

import type { CreateDashboardWidgetInput } from "@/client-sdk/services/dashboards/dashboards-api.service";

type DashboardWidgetDefinitionInput = Pick<CreateDashboardWidgetInput, "code" | "queries">;
type DashboardWidgetQueryInput = CreateDashboardWidgetInput["queries"][number];

/** The flags `dashboard widget add` and `update` share for the definition. */
export interface DefinitionFlags {
  code?: string;
  codeFile?: string;
  queriesFile?: string;
}

/** Thrown for input the CLI can refuse before any request is made. */
export class WidgetInputError extends Error {}

/** `--langy-traces`: whether the widget counts the user's conversations with Langy. */
const LANGY_TRACES: Readonly<Record<string, string[]>> = {
  included: [],
  "left-out": ["langy"],
};

/**
 * The origins a widget leaves out for `--langy-traces included|left-out`, or undefined when
 * the flag is absent, so the widget keeps what it stores (or follows its dashboard).
 */
export const resolveLangyTraces = (flag: string | undefined): string[] | undefined => {
  if (flag === undefined) return undefined;
  const origins = LANGY_TRACES[flag];
  if (!origins) {
    throw new WidgetInputError('--langy-traces takes "included" or "left-out"');
  }
  return [...origins];
};

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
