import { readFileSync } from "fs";
import type {
  PlaygroundWidgetDefinitionInput,
  PlaygroundWidgetQueryInput,
} from "@/client-sdk/services/playground-widgets/playground-widgets-api.service";

/** The flags `playground-widget create` and `update` share for the definition. */
export interface DefinitionFlags {
  code?: string;
  codeFile?: string;
  queriesFile?: string;
}

/** Thrown for input the CLI can refuse before any request is made. */
export class WidgetInputError extends Error {}

/**
 * Resolves the definition flags into the request's `{ code, queries }`, or
 * undefined when no definition flag was supplied at all (an update touching
 * only the name).
 *
 * `--code` and `--code-file` are mutually exclusive. Code and queries travel
 * together: the widget's `graph` blob holds both, so a definition needs the
 * source file (`--code`/`--code-file`) *and* its named queries
 * (`--queries-file`) — offering one without the other is refused here rather
 * than writing half a widget.
 */
export const resolveDefinitionInput = (
  flags: DefinitionFlags,
): PlaygroundWidgetDefinitionInput | undefined => {
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
 * Reads the queries file: a JSON array of `{ name, sql, parameters? }`. The
 * shape is checked by the platform's versioned schema on save — this only
 * refuses input that is not an array of objects, so a plain typo (an object,
 * a bare string) fails before a request rather than as a server rejection.
 */
const readQueriesFile = (path: string): PlaygroundWidgetQueryInput[] => {
  const raw = readTextFile(path, "queries");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new WidgetInputError(`Queries file is not valid JSON: ${path}`);
  }
  if (!Array.isArray(parsed)) {
    throw new WidgetInputError(
      `Queries file must be a JSON array of { name, sql, parameters? }: ${path}`,
    );
  }
  return parsed as PlaygroundWidgetQueryInput[];
};
