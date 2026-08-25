import { readFileSync } from "fs";
import type {
  ChartParameterValue,
  SavedChartDefinitionInput,
} from "@/client-sdk/services/charts/charts-api.service";

/** The flags `chart create` and `chart update` share for the definition. */
export interface DefinitionFlags {
  sql?: string;
  sqlFile?: string;
  param?: string[];
  specFile?: string;
}

/** Thrown for input the CLI can refuse before any request is made. */
export class ChartInputError extends Error {}

/**
 * Parses one repeatable `--param key=value` flag. Values that read as JSON
 * scalars are sent as those scalars (`--param since=7` binds a number,
 * `--param active=true` a boolean) so a saved parameter keeps the type the
 * statement's placeholder declares; anything else is sent as the string.
 */
export const parseParameterFlags = (
  flags: string[],
): Record<string, ChartParameterValue> => {
  const parameters: Record<string, ChartParameterValue> = {};
  for (const flag of flags) {
    const separator = flag.indexOf("=");
    if (separator <= 0) {
      throw new ChartInputError(
        `Invalid --param "${flag}": expected key=value`,
      );
    }
    const key = flag.slice(0, separator);
    const raw = flag.slice(separator + 1);
    parameters[key] = coerceScalar(raw);
  }
  return parameters;
};

const coerceScalar = (raw: string): ChartParameterValue => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "string" ||
      typeof parsed === "number" ||
      typeof parsed === "boolean" ||
      parsed === null
    ) {
      return parsed;
    }
  } catch {
    // Not JSON — a plain string value.
  }
  return raw;
};

/**
 * Resolves the definition flags into the request's definition, or undefined
 * when no definition flag was supplied at all (an update touching only the
 * name). `--sql` and `--sql-file` are mutually exclusive; a definition needs
 * one of them, because parameters and a specification mean nothing without
 * the statement they belong to.
 */
export const resolveDefinitionInput = (
  flags: DefinitionFlags,
): SavedChartDefinitionInput | undefined => {
  const hasDefinitionFlag =
    flags.sql !== undefined ||
    flags.sqlFile !== undefined ||
    (flags.param?.length ?? 0) > 0 ||
    flags.specFile !== undefined;
  if (!hasDefinitionFlag) return undefined;

  if (flags.sql !== undefined && flags.sqlFile !== undefined) {
    throw new ChartInputError(
      "Pass either --sql or --sql-file, not both",
    );
  }
  const sql = flags.sql ?? (flags.sqlFile ? readSqlFile(flags.sqlFile) : undefined);
  if (sql === undefined || sql.trim().length === 0) {
    throw new ChartInputError(
      "A definition needs its statement: pass --sql or --sql-file",
    );
  }

  const definition: SavedChartDefinitionInput = {
    version: 1,
    sql,
    parameters: parseParameterFlags(flags.param ?? []),
  };
  if (flags.specFile !== undefined) {
    definition.vegaLiteSpec = readSpecFile(flags.specFile);
  }
  return definition;
};

const readSqlFile = (path: string): string => {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    throw new ChartInputError(`Could not read SQL file: ${path}`);
  }
};

const readSpecFile = (path: string): Record<string, unknown> => {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    throw new ChartInputError(`Could not read specification file: ${path}`);
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ChartInputError(
        `Specification file is not a JSON object: ${path}`,
      );
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ChartInputError) throw error;
    throw new ChartInputError(
      `Specification file is not valid JSON: ${path}`,
    );
  }
};
