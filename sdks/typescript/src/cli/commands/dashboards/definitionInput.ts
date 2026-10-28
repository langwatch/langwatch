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

/**
 * The trace origins a widget query can count, as the platform's widget schema lists them; the
 * server checks them again. "other" is every origin not listed before it.
 */
const TRACE_SOURCES = [
  "application",
  "simulation",
  "evaluation",
  "coding_agent",
  "gateway",
  "workflow",
  "playground",
  "langy",
  "other",
] as const;
type TraceSource = (typeof TRACE_SOURCES)[number];

const isTraceSource = (value: string): value is TraceSource =>
  (TRACE_SOURCES as readonly string[]).includes(value);

/**
 * `--sources application,langy`: the origins every query of the widget counts, or undefined
 * when the flag is absent, so each query keeps what it stores.
 */
export const resolveSources = (flag: string | undefined): TraceSource[] | undefined => {
  if (flag === undefined) return undefined;
  const picked = flag
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const unknown = picked.filter((part) => !isTraceSource(part));
  if (picked.length === 0 || unknown.length > 0) {
    const named = unknown.length > 0 ? `unknown source "${unknown[0]}"; ` : "";
    throw new WidgetInputError(
      `--sources: ${named}pass a comma list of ${TRACE_SOURCES.join(", ")}`,
    );
  }
  return picked.filter(isTraceSource);
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
