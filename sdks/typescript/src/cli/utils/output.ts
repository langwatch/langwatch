import { Option, type Command } from "commander";
/**
 * The one place a command SAYS its successful result — the output contract:
 * `await printResult(data, { ...commandOptions, table: renderHumanTable })`.
 * Legacy flags normalise onto it via `resolveOutputOptions` — no breaking change.
 */
import type * as yaml from "js-yaml";

import { setOutputFormat } from "./outputScope";
import { parsePositiveIntOrNull } from "./positiveInt";

/**
 * js-yaml is only needed for `-o yaml`, loaded lazily and memoized: a static
 * import would put its ~8ms load cost on every invocation's cold-start path.
 * Dynamic `import()`, not `require`, keeps it visible to Bun's `build --compile`.
 */
let yamlModulePromise: Promise<typeof yaml> | undefined;
const loadYaml = (): Promise<typeof yaml> => (yamlModulePromise ??= import("js-yaml"));

/** The formats the output contract knows. */
const OUTPUT_FORMATS = ["table", "json", "agents", "yaml"] as const;

export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

const isOutputFormat = (value: string): value is OutputFormat =>
  (OUTPUT_FORMATS as readonly string[]).includes(value);

/**
 * Environment variables that mark the caller as an AI coding agent. The
 * `LW_`/`LANGWATCH_` pair is ours — the explicit opt-in; the rest are set by
 * the tools themselves (Claude Code, Cursor, Copilot CLI, Amazon Q).
 */
export const AGENT_MODE_ENV_VARS = [
  "CLAUDECODE",
  "CLAUDE_CODE",
  "CURSOR_AGENT",
  "GITHUB_COPILOT",
  "AMAZON_Q",
  "LW_AGENT_MODE",
  "LANGWATCH_AGENT_MODE",
] as const;

/** The flags a command may carry that say something about its output. */
export interface RawOutputFlags {
  /** New contract: `-o, --output <format>`. */
  output?: string;
  /** Legacy: `-f, --format <format>` ("table" | "json", "digest", "jsonl", …). */
  format?: string;
  /** New contract: `--json <fields>` (string). Legacy: bare `--json` (boolean). */
  json?: string | boolean;
  /** New contract: `--jq <expr>`. */
  jq?: string;
  /** New contract: `--limit <n>` (the shared cap; a command's own wins). */
  limit?: string;
  /** New contract: `--agent`. */
  agent?: boolean;
}

/** What the flags resolve to — one format, plus the machine projections. */
export interface ResolvedOutput {
  format: OutputFormat;
  /** Selected top-level fields from `--json <fields>`, if any. */
  fields?: string[];
  /** The `--jq` expression, if any. */
  jq?: string;
  /** The `--limit <n>` cap, when it is a positive number. */
  limit?: number;
  /** Agent mode is active (flag or env): colour and spinners are off. */
  agent: boolean;
}

/**
 * Whether the caller asked for a format EXPLICITLY, as opposed to agent mode
 * merely being active. Commands whose default is already agent-friendly raw
 * text use this to keep that default unless a machine format was requested.
 */
export const hasExplicitFormatRequest = (options?: RawOutputFlags): boolean =>
  options?.output !== undefined ||
  options?.json !== undefined ||
  options?.jq !== undefined ||
  options?.format === "json";

const isTruthyEnvValue = (value: string | undefined): boolean =>
  value !== undefined && value !== "" && value !== "0" && value !== "false";

/** Whether the environment says the caller is an agent. */
export const isAgentModeEnv = (env: NodeJS.ProcessEnv = process.env): boolean =>
  AGENT_MODE_ENV_VARS.some((name) => isTruthyEnvValue(env[name]));

/**
 * THE central option preprocessor: maps every spelling onto one resolved
 * format. Order matters: explicit flag, explicit json/jq, legacy `-f json`
 * only (not table/digest/jsonl, commander defaults), agent mode, then table.
 */
export const resolveOutputOptions = (
  raw: RawOutputFlags,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedOutput => {
  const agent = raw.agent === true || isAgentModeEnv(env);
  const fields =
    typeof raw.json === "string"
      ? raw.json
          .split(",")
          .map((field) => field.trim())
          .filter((field) => field.length > 0)
      : undefined;

  let format: OutputFormat;
  if (raw.output !== undefined && isOutputFormat(raw.output)) {
    format = raw.output;
  } else if (raw.json !== undefined || raw.jq !== undefined) {
    format = "json";
  } else if (raw.format === "json") {
    format = "json";
  } else if (agent) {
    format = "agents";
  } else {
    format = "table";
  }

  // A cap that is not a positive whole number is ignored rather than obeyed: a
  // typo must not turn a list into one row and read as the whole answer.
  const limit =
    raw.limit === undefined ? undefined : (parsePositiveIntOrNull(raw.limit) ?? undefined);

  return {
    format,
    ...(fields?.length ? { fields } : {}),
    ...(raw.jq !== undefined ? { jq: raw.jq } : {}),
    ...(limit !== undefined ? { limit } : {}),
    agent,
  };
};

/**
 * The preAction view of the command's output context, resolved. One spelling
 * needs disambiguating: `dataset records add/update` owns its own `--json
 * <json>` PAYLOAD option, not the contract's fields spelling — DATA, not intent.
 */

/**
 * Whether the command declares its OWN `--json`, not the contract's hidden
 * injected copy — needed both for the payload-vs-fields check above and
 * `assertFormatIsSupported`'s bypass, so it lives here once.
 */
const ownsOwnJsonFlag = (command: Command): boolean => ownsOwnOptionFlag(command, "--json");

/**
 * Does the command define this long flag ITSELF? `trace export -o <file>`
 * owns `-o`, so its value must not resolve as output intent. Hidden copies
 * don't count: the contract registers its own flags hidden.
 */
const ownsOwnOptionFlag = (command: Command, long: string): boolean =>
  command.options.some((option) => option.long === long && !option.hidden);

export const resolveActionOutputOptions = (
  actionCommand: Command,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedOutput => {
  const raw: RawOutputFlags = actionCommand.optsWithGlobals();
  if (typeof raw.json === "string" && ownsOwnJsonFlag(actionCommand)) {
    delete raw.json;
  }
  // Same reasoning as `--json` above, for the flag that names the format: when
  // the command owns `-o/--output` its value is that command's argument (a file
  // path), never a format name.
  if (ownsOwnOptionFlag(actionCommand, "--output")) {
    delete raw.output;
  }
  return resolveOutputOptions(raw, env);
};

/** The value at a dot-path key: `null` wherever jq would answer `null`. */
const descend = (value: unknown, key: string): unknown => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return (value as Record<string, unknown>)[key] ?? null;
};

/**
 * A path segment: a key, then repeatable `[]`/`[n]` accessors — ALLOWLIST,
 * deliberately. A denylist leaked (missed operators like `.n - 1`), so
 * unmatched input is REJECTED rather than nulled as a literal key.
 */

// A minus needs digits after it: `[-]` would otherwise parse as an index of
// NaN and traverse to null instead of failing like an unsupported expression.
const SUPPORTED_SEGMENT_RE = /^([A-Za-z_][A-Za-z0-9_-]*)?((?:\[(?:-?\d+)?\])*)$/;

/**
 * What to do instead, on every refusal. This subset stays small on purpose;
 * the shell carries the full tools, and saying so stops the caller trying
 * three spellings of the same idea and losing all three.
 */
const USE_THE_SHELL =
  " Redirect the answer to a file (`--format json > results.json`) and narrow it" +
  " there: real `jq` and `python` are both in your shell.";

/** One move along the path: into a key, over an array, or at one index. */
type PathStep =
  | { kind: "key"; key: string }
  | { kind: "iterate" }
  | { kind: "index"; index: number };

/**
 * The path expression as a flat list of steps. Splitting on "." alone is not
 * enough once a segment carries accessors, so each is parsed into its key and
 * accessors, becoming one list the walk can read without looking back.
 */
const parsePathSteps = (expression: string): PathStep[] => {
  const steps: PathStep[] = [];
  const segments = expression.slice(1).split(".");

  segments.forEach((segment, position) => {
    const match = SUPPORTED_SEGMENT_RE.exec(segment);
    if (!match) {
      throw new Error(
        `Invalid --jq expression "${expression}": unsupported syntax at "${segment}" ` +
          `(supported: dot paths, .items[], .items[].field, .items[0], length; ` +
          `no quoting, optionals or operators).` +
          USE_THE_SHELL,
      );
    }

    const [, key, accessors = ""] = match;
    if (key === undefined && accessors === "") {
      // An empty segment with nothing on it: `.a..b`, or a trailing dot. Only
      // the FIRST segment may be empty, and only to carry a root accessor
      // (`.[]`, `.[0]`), which the accessor branch below handles.
      throw new Error(
        `Invalid --jq expression "${expression}": empty segment at position ${position + 1}.` +
          USE_THE_SHELL,
      );
    }
    if (key !== undefined) steps.push({ kind: "key", key });

    for (const accessor of accessors.match(/\[(?:-?\d+)?\]/g) ?? []) {
      const inner = accessor.slice(1, -1);
      steps.push(inner === "" ? { kind: "iterate" } : { kind: "index", index: Number(inner) });
    }
  });

  return steps;
};

/**
 * The built-in jq subset: dot paths, `[]` iteration, `[n]` indexing, `length`.
 * Everything else throws rather than silently printing `null`; an
 * out-of-range index still answers `null`, matching real jq.
 */
export const applyJq = (expression: string, data: unknown): unknown => {
  const trimmed = expression.trim();

  // A terminal pipe operator: `.commands | length`. Handled before the path
  // walk — without this the whole "a | b" string would be looked up as a KEY
  // and silently print null, which is exactly the wrong answer an agent would
  // then build on. Bare `length` is jq's own spelling of `. | length`, and is
  // the first thing an agent reaches for to count a list.
  const pipeIndex = trimmed.indexOf("|");
  if (pipeIndex !== -1 || trimmed === "length") {
    return applyJqLength(expression, trimmed, pipeIndex, data);
  }

  if (!trimmed.startsWith(".")) {
    throw new Error(
      `Invalid --jq expression "${expression}": must start with "." (supported: dot paths, ` +
        `.items[], .items[].field, .items[0], length, | length).` +
        USE_THE_SHELL,
    );
  }
  if (trimmed === ".") return data;

  return walkJqPath(data, parsePathSteps(trimmed), "", expression);
};

/**
 * `--json <fields>`: pick fields, per item when data is an array. Dotted
 * paths (`config.evaluatorType`) work too — a flat lookup would miss and
 * null-fill, falsely reporting "no such field"; the key stays dotted.
 */
const selectFields = (data: unknown, fields: string[]): unknown => {
  const valueAt = (item: unknown, field: string): unknown => {
    let cursor = item;
    for (const segment of field.split(".")) {
      cursor = descend(cursor, segment);
      if (cursor === null) return null;
    }
    return cursor;
  };
  const pick = (item: unknown): unknown => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return item;
    }
    return Object.fromEntries(fields.map((field) => [field, valueAt(item, field)]));
  };
  return Array.isArray(data) ? data.map(pick) : pick(data);
};

const serialize = async (data: unknown, format: OutputFormat): Promise<string> => {
  if (format === "json") return JSON.stringify(data, null, 2);
  if (format === "agents") return JSON.stringify(data);
  // js-yaml's dump already ends in "\n"; trim it so console.log adds exactly one.
  return (await loadYaml()).dump(data).replace(/\n$/, "");
};

/**
 * The rows in a payload: a top-level array, or the one array a list envelope
 * holds. Structural, not a key list — ambiguous shapes answer "nothing to
 * cut" (payload stays whole) rather than guess wrong and drop data.
 */
const collectionKeyOf = (data: unknown): string | null => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const arrayKeys = Object.keys(record).filter((key) => Array.isArray(record[key]));
  if (arrayKeys.length !== 1) return null;
  return "pagination" in record || Object.keys(record).length === 1 ? arrayKeys[0]! : null;
};

/**
 * `--limit <n>`: keep at most n rows — a projection, not a fetch limit. ~20
 * commands already page server-side with their own `--limit` (better, kept);
 * this covers the rest, so the flag reads as universal, not "unknown option".
 */
const applyLimit = (data: unknown, limit: number): unknown => {
  if (Array.isArray(data)) return data.slice(0, limit);

  const key = collectionKeyOf(data);
  if (!key) return data;

  const record = data as Record<string, unknown>;
  return { ...record, [key]: (record[key] as unknown[]).slice(0, limit) };
};

/**
 * The other names a paginated list has given "how many there are in all".
 * `total` is the common one; the search-backed lists (traces, experiments) say
 * `totalHits`, because each list follows the shape of the API it calls.
 */
const TOTAL_ALIASES = ["totalHits"] as const;

/**
 * One spelling of the total on every paginated envelope: search-backed lists
 * answered null on `.pagination.total`, so callers guessed from a capped
 * page length. The original field (`totalHits`) stays too, alongside this one.
 */
const withNormalizedTotal = (data: unknown): unknown => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  const pagination = record.pagination;
  if (!pagination || typeof pagination !== "object" || Array.isArray(pagination)) return data;

  const paginationRecord = pagination as Record<string, unknown>;
  if (typeof paginationRecord.total === "number") return data;

  const named = TOTAL_ALIASES.find((field) => typeof paginationRecord[field] === "number");
  if (!named) return data;

  return {
    ...record,
    pagination: { ...paginationRecord, total: paginationRecord[named] },
  };
};

/**
 * The payload as asked: cut to `--limit`, narrowed to `--json <fields>`, then
 * filtered through `--jq`. The cap runs first, so `--limit 5 --jq length`
 * answers 5 rather than the size of an already-projected page.
 */
const projectResult = (data: unknown, resolved: ResolvedOutput): unknown => {
  // The total is normalized BEFORE the cap, so `--limit 5` still prints the
  // total of the whole list rather than the size of the page.
  let out = withNormalizedTotal(data);
  if (resolved.limit !== undefined) out = applyLimit(out, resolved.limit);
  if (resolved.fields) out = selectFields(out, resolved.fields);
  if (resolved.jq) out = applyJq(resolved.jq, out);
  return out;
};

export interface PrintResultOptions extends RawOutputFlags {
  /**
   * Renders the human form of the result (the command's existing chalk
   * table/details output). Only invoked when the resolved format is `table`;
   * machine formats never touch it, so it can assume a person is watching.
   */
  table: () => void;
}

/**
 * Print a command's result in the format asked for. `table` keeps each
 * command's human output as-is; every machine format renders here once,
 * async only so yaml can lazy-load `js-yaml` (callers must await it).
 */
export const printResult = async (data: unknown, options: PrintResultOptions): Promise<void> => {
  const { table, ...raw } = options;
  const resolved = resolveOutputOptions(raw);

  if (resolved.format === "table") {
    table();
    return;
  }

  // No cap here: these commands render their own resolved format, and the ones
  // that take a `--limit` mean their own paging flag by it (see CAPPED_COMMANDS).
  const out = projectResult(data, { ...resolved, limit: undefined });

  console.log(await serialize(out, resolved.format));
};

/**
 * What a command SAYS, not what it PRINTS: `data` is the one payload every
 * format projects from, and the command never learns which was asked for.
 * Resolving it per-command instead fails silently, looking like success.
 */
export interface CommandResult {
  /** The payload. `-o json|yaml|agents`, `--json <fields>` and `--jq` all project from this. */
  data: unknown;
  /** Renders the human form. Only invoked when the resolved format is `table`. */
  table: () => void;
}

/**
 * Commands whose action speaks the output contract, marked at registration
 * by `emitsResult` rather than sniffed off the handler: commander wraps `fn`
 * in its own closure, so tagging `fn` itself would be unreachable.
 */
const OUTPUT_AWARE_COMMANDS = new WeakSet<Command>();

/**
 * Commands whose `--limit` is the shared cap, not their own paging flag.
 * ~20 commands page server-side with a `--limit` meaning something else
 * (rows fetched); capping on top would cut results the caller asked for.
 */
const CAPPED_COMMANDS = new WeakSet<Command>();

/**
 * The output PORT: a command's RETURN renders in the caller's format, once.
 * Reads `optsWithGlobals()`, not `opts()`: a root-position flag only lands
 * on the ROOT command, so a leaf's `opts()` silently drops it.
 */
export const emitsResult = <Args extends unknown[]>(
  command: Command,
  handler: (...args: Args) => Promise<CommandResult | void> | CommandResult | void,
): Command => {
  OUTPUT_AWARE_COMMANDS.add(command);
  return command.action(async (...args: unknown[]): Promise<void> => {
    const actionCommand = args[args.length - 1] as Command;
    const result = await handler(...(args as unknown as Args));
    if (!result) return;

    const resolved = resolveActionOutputOptions(actionCommand);
    if (resolved.format === "table") {
      result.table();
      return;
    }
    const out = projectResult(
      result.data,
      CAPPED_COMMANDS.has(actionCommand) ? resolved : { ...resolved, limit: undefined },
    );
    console.log(await serialize(out, resolved.format));
  });
};

/**
 * The other half of the port: marks a command that renders itself via
 * `printResult` instead of returning a `CommandResult` — needed only when
 * work must follow the output without reordering it (prefer `emitsResult`).
 */
export const rendersOwnResult = (command: Command): Command => {
  OUTPUT_AWARE_COMMANDS.add(command);
  return command;
};

/** Whether this command's action speaks the output contract. */
export const isOutputAware = (command: Command): boolean => OUTPUT_AWARE_COMMANDS.has(command);

/**
 * Refuse an EXPLICIT machine format an unmigrated command can't produce —
 * it would print its chalk table at exit 0, lying to a JSON-asking caller.
 * Agent mode merely detected from env is NOT explicit, so it only warns.
 */
export const assertFormatIsSupported = async (
  actionCommand: Command,
  resolved: ResolvedOutput,
): Promise<ResolvedOutput> => {
  if (resolved.format === "table" || isOutputAware(actionCommand)) return resolved;

  // A command with its own non-hidden `--json` (daemon status, ingest/
  // governance) already emits machine output through it — bare `--json`
  // passes through. Narrowly, though: `-o yaml` and `--jq` are still beyond
  // it, so those stay refusable (owning `--json` proves ITS json, not every
  // format).
  if (ownsOwnJsonFlag(actionCommand)) {
    const globalOpts = actionCommand.optsWithGlobals();

    if (globalOpts.output === undefined && globalOpts.jq === undefined) {
      return resolved;
    }
  }

  const raw: RawOutputFlags = actionCommand.optsWithGlobals();
  const name = actionCommand.name();

  // Only NEW flags are refusable: legacy `-f/--format json` isn't (unmigrated
  // commands handle it themselves). `raw.agent` isn't either — a MODE, not a
  // format demand, so it degrades with a warning (pinned by a test, don't
  // "fix" this in). A command-owned flag isn't either: `trace export -o` is a
  // file path, not a format demand — only `--output` is carved out this way.
  const requestedNewContractFlag =
    (raw.output !== undefined && !ownsOwnOptionFlag(actionCommand, "--output")) ||
    raw.jq !== undefined ||
    raw.json !== undefined;

  if (requestedNewContractFlag) {
    const { commandValidationError, reportCommandError } = await import("./errorOutput.js");
    // Reported here rather than thrown: `preAction` runs OUTSIDE each
    // registration's try/catch, so a throw escapes to the dependency-free net
    // in index.ts and renders as `Error: [object Object]` — prose at a parser,
    // the exact failure this contract exists to end.
    reportCommandError({
      error: commandValidationError(
        `\`${name}\` does not emit structured output yet, so --output/--json/--jq cannot be honoured. ` +
          `Re-run without them for the human table, or use \`lw commands\` to find a command that does.`,
        { command: name, requestedFormat: resolved.format },
      ),
    });
    process.exit(1);
  }

  // Legacy `-f/--format json`: the command renders this itself, so pass it
  // through untouched. Falling into the downgrade below would rewrite it to
  // `table` and break output that has always worked.
  if (raw.format === "json") return resolved;

  // Auto-detected agent mode: keep the human table, but never let a caller
  // believe it is parsing structured output.
  process.stderr.write(
    `note: \`${name}\` does not emit structured output yet. The table below is not machine-readable.\n`,
  );
  return { ...resolved, format: "table" };
};

/**
 * Applies the resolved output context once per action, from `preAction`.
 * Under the daemon this lands in the request's AsyncLocalStorage scope, so
 * concurrent requests can't clobber each other's format or colour.
 */
export const applyOutputContext = async (resolved: ResolvedOutput): Promise<void> => {
  // Machine formats fail as structured documents; agent mode's document is the
  // compact single-line form (see renderErrorAsJson), everything else pretty.
  setOutputFormat(errorOutputFormat(resolved.format));
  if (resolved.agent) {
    const { disableOutputColor } = await import("./errorOutput.js");
    disableOutputColor();
  }
};

/**
 * The global output flags, skipped only for conflicts: commands with their
 * own boolean `--json` keep it, `trace export` keeps `-o/--output <file>`,
 * and the gateway wrappers (pass-through to a wrapped binary) get neither.
 */
export const registerOutputOptions = (program: Command): void => {
  const globals: GlobalOutputOption[] = [
    {
      flags: "-o, --output <format>",
      description:
        "Output format: table (default), json, agents (compact single-line JSON), or yaml",
      long: "--output",
      short: "-o",
      // Constrained so a typo (`-o jsn`) errors loudly at parse time instead
      // of silently falling back to a table. `trace export` is unaffected: it
      // defines its own `-o, --output <file>`, which wins the conflict check
      // below and never receives these choices.
      choices: OUTPUT_FORMATS,
    },
    {
      flags: "--json <fields>",
      description: "Emit JSON with only the given comma-separated fields",
      long: "--json",
    },
    {
      flags: "--jq <expr>",
      description:
        "Filter output with a path expression (e.g. .traces[].traceId, .traces[0], length)",
      long: "--jq",
    },
    {
      flags: "--limit <n>",
      description: "Keep at most n rows of the result (json, agents and yaml output)",
      long: "--limit",
      // Only where the command has no paging `--limit` of its own, and only on
      // commands that return their payload through the port: the cap is applied
      // by `emitsResult`, so a command that renders itself would accept the flag
      // and quietly ignore it.
      outputAwareOnly: true,
    },
    {
      flags: "--agent",
      description:
        "Agent mode: compact JSON output, no colour, no spinners (auto-detected from agent env vars)",
      long: "--agent",
    },
  ];

  const visit = (command: Command, isRoot: boolean): void => {
    // Commander private API: there is no public accessor for
    // allowUnknownOption — re-check on commander upgrades.
    const allowsUnknown =
      (command as unknown as { _allowUnknownOption?: boolean })._allowUnknownOption === true;

    if (!allowsUnknown) {
      for (const option of globals) {
        registerGlobalOutputOption(command, option, isRoot);
      }
    }

    command.commands.forEach((child) => visit(child, false));
  };

  visit(program, true);
};

function errorOutputFormat(format: string): "agents" | "json" | undefined {
  if (format === "table") return void 0;
  return format === "agents" ? "agents" : "json";
}

function walkJqPath(value: unknown, rest: PathStep[], path: string, expression: string): unknown {
  const [head, ...tail] = rest;
  if (head === undefined) return value;

  if (head.kind === "key") {
    const at = `${path}.${head.key}`;
    return walkJqPath(descend(value, head.key), tail, at, expression);
  }

  if (head.kind === "index") {
    const at = `${path}[${head.index}]`;
    if (!Array.isArray(value)) {
      throw new Error(
        `Invalid --jq expression "${expression}": "${at}" indexes a value that is not an array`,
      );
    }
    // jq counts a negative index from the end, and answers null past either
    // end rather than failing.
    const resolved = head.index < 0 ? value.length + head.index : head.index;
    return walkJqPath(value[resolved] ?? null, tail, at, expression);
  }

  const at = `${path}[]`;
  if (!Array.isArray(value)) {
    throw new Error(
      `Invalid --jq expression "${expression}": "${at}" iterates over a non-array value`,
    );
  }
  const mapped = value.map((item) => walkJqPath(item, tail, at, expression));
  // Chained iteration COLLECTS, it does not nest: `.traces[].spans[].id` is
  // `["s1","s2","s3"]`, matching `jq '[ .traces[].spans[].id ]'`, not
  // `[["s1","s2"],["s3"]]`. Each nested level has already flattened itself,
  // so exactly one flatten per iterating step is correct.
  return tail.some((step) => step.kind === "iterate") ? mapped.flat() : mapped;
}

interface GlobalOutputOption {
  flags: string;
  description: string;
  long: string;
  short?: string;
  choices?: readonly string[];
  /** Register only on commands that answer through the output port. */
  outputAwareOnly?: boolean;
}

function registerGlobalOutputOption(
  command: Command,
  option: GlobalOutputOption,
  isRoot: boolean,
): void {
  const conflicts = command.options.some(
    (existing) =>
      existing.long === option.long ||
      (option.short !== undefined && existing.short === option.short),
  );
  if (conflicts) return;
  if (option.outputAwareOnly && !OUTPUT_AWARE_COMMANDS.has(command)) return;
  if (option.outputAwareOnly) CAPPED_COMMANDS.add(command);

  const created = new Option(option.flags, option.description);
  if (option.choices) created.choices([...option.choices]);
  // Hidden on subcommands: the program is built with
  // `configureHelp({ showGlobalOptions: true })`, so every command's
  // help already renders the ROOT's copies under "Global Options:" —
  // showing each command's own copy too would list every flag twice.
  // Hidden options still parse, which is all the flags need to do here.
  if (!isRoot) created.hideHelp();
  command.addOption(created);
}

function applyJqLength(
  expression: string,
  trimmed: string,
  pipeIndex: number,
  data: unknown,
): unknown {
  const path = pipeIndex === -1 ? "." : trimmed.slice(0, pipeIndex).trim();
  const operator = pipeIndex === -1 ? "length" : trimmed.slice(pipeIndex + 1).trim();
  if (path.length === 0) {
    throw new Error(
      `Invalid --jq expression "${expression}": nothing before the pipe.` + USE_THE_SHELL,
    );
  }

  // `a | b` where b is a path is just b applied to what a produced, which is
  // how `.data[] | .slug` is written. An iterating left side produced a list,
  // and jq applies the right side to each of its elements.
  if (operator.startsWith(".")) {
    const left = applyJq(path, data);
    return path.includes("[]") && Array.isArray(left)
      ? left.map((item) => applyJq(operator, item))
      : applyJq(operator, left);
  }

  if (operator !== "length") {
    throw new Error(
      `Invalid --jq expression "${expression}": after a pipe this supports a path (".slug") or "length".` +
        USE_THE_SHELL,
    );
  }
  const value = applyJq(path, data);
  if (typeof value === "string" || Array.isArray(value)) return value.length;
  if (value !== null && typeof value === "object") {
    return Object.keys(value).length;
  }
  throw new Error(
    `Invalid --jq expression "${expression}": "| length" applied to a value with no size`,
  );
}
