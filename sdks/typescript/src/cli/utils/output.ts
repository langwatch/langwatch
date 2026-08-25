/**
 * The one place a command SAYS its successful result — the output contract.
 *
 * Success output used to be hand-rolled per command: some read
 * `--format json`, some a boolean `--json`, some only ever print a table. An
 * agent driving this CLI had to learn each spelling, and flags like `--jq`
 * or `--yaml` did not exist at all. This module replaces that with a single
 * helper and a single resolution function:
 *
 *   await printResult(data, { ...commandOptions, table: renderHumanTable })
 *
 * Formats:
 *
 *   table   the human default — the command's own chalk rendering, passed in
 *           as the `table` callback so it stays visually identical.
 *   json    pretty 2-space JSON.
 *   agents  compact single-line JSON, for LLM context windows. The default
 *           when agent mode is active and nothing more specific was asked for.
 *   yaml    YAML via js-yaml (already a CLI dependency). js-yaml is loaded
 *           lazily — a dynamic import only when YAML output is actually
 *           requested — so the ~8ms it costs to load is not paid by every
 *           invocation. This is why `printResult` is async.
 *
 * Flags (registered on every command by `registerOutputOptions`):
 *
 *   -o, --output <format>   the explicit format. Always wins.
 *   --json <fields>         comma-separated field selection; implies json.
 *   --jq <expr>             a TINY built-in subset — dot paths (`.a.b`), array
 *                           iteration (`.items[]`), an optional field after it
 *                           (`.items[].name`), indexing (`.items[0]`, `.items[-1]`)
 *                           and `length`, with or without a pipe in front. No
 *                           jq dependency.
 *   --limit <n>             keep at most n rows of the result. A projection,
 *                           like `--jq`, so it applies to the machine formats
 *                           only; a command with its own paging `--limit` keeps
 *                           that one instead.
 *   --agent                 agent mode (also auto-detected from env, see
 *                           AGENT_MODE_ENV_VARS): agents format by default,
 *                           colour off, spinners off.
 *
 * Legacy flags keep working: `-f/--format json` and the bare boolean `--json`
 * (the ingest/governance/daemon spelling) are normalised onto the same
 * contract by `resolveOutputOptions` — one central preprocessor, no
 * per-command edits, no breaking change.
 */
import type * as yaml from "js-yaml";
import { Option, type Command } from "commander";
import { setOutputFormat } from "./outputScope";

/**
 * js-yaml is only needed for `-o yaml`, so it is loaded lazily and memoized:
 * a static import here would put its ~8ms load cost on the cold-start path of
 * EVERY invocation (this module is imported by `program.ts`). A dynamic
 * import (not a bare `require`) keeps it bundle-visible to Bun's
 * `build --compile`, which cannot see through `createRequire`.
 */
let yamlModulePromise: Promise<typeof yaml> | undefined;
const loadYaml = (): Promise<typeof yaml> =>
  (yamlModulePromise ??= import("js-yaml"));

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
 * Whether the caller asked for a format EXPLICITLY (any spelling) — as
 * opposed to agent mode merely being active in the environment. Commands
 * whose default output is already agent-friendly raw text (help-tree,
 * skills get) use this to keep that default unless a machine format was
 * actually requested.
 */
export const hasExplicitFormatRequest = (options?: RawOutputFlags): boolean =>
  options?.output !== undefined ||
  options?.json !== undefined ||
  options?.jq !== undefined ||
  options?.format === "json";

const isTruthyEnvValue = (value: string | undefined): boolean =>
  value !== undefined && value !== "" && value !== "0" && value !== "false";

/** Whether the environment says the caller is an agent. */
export const isAgentModeEnv = (
  env: NodeJS.ProcessEnv = process.env,
): boolean => AGENT_MODE_ENV_VARS.some((name) => isTruthyEnvValue(env[name]));

/**
 * THE central option preprocessor: maps every spelling a caller can use —
 * new or legacy — onto one resolved format. Pure, so tests (and commands
 * that need to know the format before rendering, like trace search's
 * progress events) can resolve without printing.
 *
 * Precedence:
 *
 *   1. `-o/--output <format>` — explicit always wins (even over agent mode).
 *   2. `--json <fields>` / bare `--json` / `--jq` — explicit machine intent.
 *   3. Legacy `-f/--format json` — the only legacy value that means machine.
 *      ("table"/"digest"/"jsonl" are human spellings, and also the commander
 *      DEFAULTS of those commands, so they must not beat agent mode below.)
 *   4. Agent mode — `agents` when nothing more specific was asked for.
 *   5. `table` — the human default.
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
  const cap = raw.limit === undefined ? NaN : parseInt(raw.limit, 10);
  const limit = Number.isFinite(cap) && cap > 0 ? cap : undefined;

  return {
    format,
    ...(fields?.length ? { fields } : {}),
    ...(raw.jq !== undefined ? { jq: raw.jq } : {}),
    ...(limit !== undefined ? { limit } : {}),
    agent,
  };
};

/**
 * The preAction view of the running command's output context: the command's
 * merged options (its own plus the globals), resolved.
 *
 * One spelling needs disambiguating here rather than in `resolveOutputOptions`:
 * `dataset records add/update` carry their own `--json <json>` PAYLOAD option
 * (a JSON document, required even), which is not the contract's `--json
 * <fields>`. A string there is DATA, not machine-output intent — without this
 * rule a plain human caller adding records would get JSON errors and silenced
 * spinners. The contract's copy is `hideHelp()`'d on every command that does
 * not define its own, so a NON-hidden `--json` on the action command means
 * "this command owns the flag".
 */
/**
 * Whether the command declares its OWN `--json`, as opposed to the contract's
 * injected copy.
 *
 * `registerOutputOptions` `hideHelp()`s every copy it injects, so a NON-hidden
 * `--json` means the command declared it. Two callers ask this question and
 * want different things from the answer — the payload-vs-fields
 * disambiguation below, and `assertFormatIsSupported`'s narrow bypass — so it
 * lives here once rather than being hand-rolled at each site with its own
 * subtly different meaning.
 */
const ownsOwnJsonFlag = (command: Command): boolean =>
  ownsOwnOptionFlag(command, "--json");

/**
 * Does the command define this long flag ITSELF, for its own purposes?
 *
 * `registerOutputOptions` puts the contract's flags on every command, but it
 * refuses to overwrite one a command already owns — `trace export -o <file>`
 * keeps meaning a file path. The reading side has to make the same distinction,
 * or an owned flag gets read as output intent: `trace export -o traces.jsonl`
 * would resolve `traces.jsonl` as a FORMAT, and under an agent env var the
 * format gate then refuses the command outright for asking.
 *
 * Hidden options don't count: the contract's own flags are registered hidden on
 * commands that already own the spelling, so counting them would make every
 * command look like the owner.
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
 * What a path segment may look like: a key, then any number of accessors.
 *
 * An ALLOWLIST, deliberately. Anything not matching is REJECTED rather than
 * walked as a literal key, because `descend` answers `null` for any key it
 * cannot resolve: `.traces(x)` would otherwise look up a property literally
 * named `traces(x)`, miss, and print `null` at exit 0, a fabricated answer an
 * agent then builds on.
 *
 * A denylist was tried first and leaked: it caught brackets and quotes but not
 * operators, so `.n - 1` and `.n,.s` still answered `null` silently. Since the
 * grammar here is tiny and closed, the safe default is to name what IS legal
 * and reject the rest.
 *
 * The accessor part is `[]` (iterate) or `[n]` (index, negative counts from the
 * end), repeatable: `.traces[0]`, `.traces[].spans[0]`, `.matrix[0][1]`. The key
 * is optional so root accessors parse too (`.[]`, `.[0]`).
 */
const SUPPORTED_SEGMENT_RE = /^([A-Za-z_][A-Za-z0-9_-]*)?((?:\[-?\d*\])*)$/;

/** One move along the path: into a key, over an array, or at one index. */
type PathStep =
  | { kind: "key"; key: string }
  | { kind: "iterate" }
  | { kind: "index"; index: number };

/**
 * The path expression as a flat list of steps.
 *
 * Splitting on "." alone is not enough once a segment carries accessors, so each
 * segment is parsed into its key and its accessors, and the whole path becomes
 * one list the walk can read without looking back at the text.
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
          `no quoting, optionals or operators)`,
      );
    }

    const [, key, accessors = ""] = match;
    if (key === undefined && accessors === "") {
      // An empty segment with nothing on it: `.a..b`, or a trailing dot. Only
      // the FIRST segment may be empty, and only to carry a root accessor
      // (`.[]`, `.[0]`), which the accessor branch below handles.
      throw new Error(
        `Invalid --jq expression "${expression}": empty segment at position ${position + 1}`,
      );
    }
    if (key !== undefined) steps.push({ kind: "key", key });

    for (const accessor of accessors.match(/\[-?\d*\]/g) ?? []) {
      const inner = accessor.slice(1, -1);
      steps.push(
        inner === "" ? { kind: "iterate" } : { kind: "index", index: Number(inner) },
      );
    }
  });

  return steps;
};

/**
 * The built-in jq subset: `.`, `.a.b`, `.items[]`, `.items[].name`, `.items[0]`
 * (negative indexes count from the end), and a terminal `| length` on arrays,
 * strings and objects, and bare `length` too, which is how jq itself spells the
 * count of the whole document. Iteration collects into an array, the way
 * `jq '[ .items[].name ]'` reads.
 *
 * Everything else throws. A wrong expression must fail loudly, not silently
 * print `null` into a pipeline, and an out-of-range index is not a wrong
 * expression: jq answers `null` there and so does this.
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
    const path = pipeIndex === -1 ? "." : trimmed.slice(0, pipeIndex).trim();
    const operator = pipeIndex === -1 ? "length" : trimmed.slice(pipeIndex + 1).trim();
    if (operator !== "length" || path.length === 0) {
      throw new Error(
        `Invalid --jq expression "${expression}": only a terminal "| length" pipe is supported`,
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

  if (!trimmed.startsWith(".")) {
    throw new Error(
      `Invalid --jq expression "${expression}": must start with "." (supported: dot paths, ` +
        `.items[], .items[].field, .items[0], length, | length)`,
    );
  }
  if (trimmed === ".") return data;

  const walk = (value: unknown, rest: PathStep[], path: string): unknown => {
    const [head, ...tail] = rest;
    if (head === undefined) return value;

    if (head.kind === "key") {
      const at = `${path}.${head.key}`;
      return walk(descend(value, head.key), tail, at);
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
      return walk(value[resolved] ?? null, tail, at);
    }

    const at = `${path}[]`;
    if (!Array.isArray(value)) {
      throw new Error(
        `Invalid --jq expression "${expression}": "${at}" iterates over a non-array value`,
      );
    }
    const mapped = value.map((item) => walk(item, tail, at));
    // Chained iteration COLLECTS, it does not nest: `.traces[].spans[].id` is
    // `["s1","s2","s3"]`, matching `jq '[ .traces[].spans[].id ]'`, not
    // `[["s1","s2"],["s3"]]`. Each nested level has already flattened itself,
    // so exactly one flatten per iterating step is correct.
    return tail.some((step) => step.kind === "iterate") ? mapped.flat() : mapped;
  };

  return walk(data, parsePathSteps(trimmed), "");
};

/**
 * `--json <fields>`: pick fields, per item when data is an array.
 *
 * Fields may be dotted paths (`config.evaluatorType`). A flat property lookup
 * would treat that as a literal key, miss, and null-fill — reporting "this
 * record has no such field" for a field it does have, which is a lie a machine
 * caller cannot detect. The resulting key keeps the dotted spelling the caller
 * asked for, so the projection round-trips.
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
 * holds (`{ experiments: [...], pagination }`).
 *
 * Structural, not a key list, and deliberately narrow: an object with two arrays
 * in it, or an array beside fields the caller may be reading, is NOT a list to
 * cut. Answering "there is nothing here to cut" leaves the payload whole, which
 * is always a safe answer; guessing wrong would drop data silently.
 */
const collectionKeyOf = (data: unknown): string | null => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const arrayKeys = Object.keys(record).filter((key) =>
    Array.isArray(record[key]),
  );
  if (arrayKeys.length !== 1) return null;
  return "pagination" in record || Object.keys(record).length === 1
    ? arrayKeys[0]!
    : null;
};

/**
 * `--limit <n>`: keep at most n rows of the payload.
 *
 * A projection, like `--jq`: the command still fetched what it fetched; this
 * decides how much of it is printed. It exists because "unknown option
 * '--limit'" is where an agent's first read of an unfamiliar list command ends:
 * about twenty commands page server-side with a `--limit` of their own, so the
 * flag reads as universal, and the ones without it answered with an error and a
 * usage dump. Those keep their own flag (it pages, which is better); everything
 * else now takes the cap here.
 */
const applyLimit = (data: unknown, limit: number): unknown => {
  if (Array.isArray(data)) return data.slice(0, limit);

  const key = collectionKeyOf(data);
  if (!key) return data;

  const record = data as Record<string, unknown>;
  return { ...record, [key]: (record[key] as unknown[]).slice(0, limit) };
};

/**
 * The payload as the caller asked to see it: cut to `--limit`, narrowed to
 * `--json <fields>`, then filtered through `--jq`.
 *
 * That order is the readable one: the cap says how many rows, the projections
 * say what to read off them, so `--limit 5 --jq length` answers 5.
 */
const projectResult = (data: unknown, resolved: ResolvedOutput): unknown => {
  let out = data;
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
 * Print a command's successful result in the format the caller asked for.
 *
 * The `table` callback keeps each command's human output exactly as it was;
 * every machine format (json/agents/yaml, `--json` fields, `--jq`) is
 * rendered here, once, instead of per command.
 *
 * Async solely so the yaml format can lazy-load js-yaml (see `loadYaml`);
 * callers must await it so output ordering is preserved.
 */
export const printResult = async (
  data: unknown,
  options: PrintResultOptions,
): Promise<void> => {
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
 * What a command SAYS, as opposed to what it PRINTS.
 *
 * A command action returns this instead of writing to stdout itself: `data` is
 * the raw payload — the single source of truth every machine format projects
 * from — and `table` renders the human form. The command never learns which
 * format was asked for; the port below decides. That is the whole point: when
 * format resolution lives in 150 command files, 129 of them get it wrong and
 * nothing detects it, because a chalk table on stdout at exit 0 looks exactly
 * like success.
 */
export interface CommandResult {
  /** The payload. `-o json|yaml|agents`, `--json <fields>` and `--jq` all project from this. */
  data: unknown;
  /** Renders the human form. Only invoked when the resolved format is `table`. */
  table: () => void;
}

/**
 * Commands whose action speaks the output contract.
 *
 * Marked at registration by `emitsResult` rather than sniffed off the handler:
 * commander's `.action(fn)` stores its OWN listener wrapping `fn`, so anything
 * we tag `fn` with is sealed inside that closure and unreachable. A WeakSet
 * keyed on the command is both simpler and free of commander private API.
 */
const OUTPUT_AWARE_COMMANDS = new WeakSet<Command>();

/**
 * Commands whose `--limit` is the shared cap rather than their own paging flag.
 *
 * About twenty commands page server-side with a `--limit` of their own, and
 * theirs means different things: how many to fetch, how many rows to print, how
 * big a page of a walk that covers the whole window either way. Capping the
 * printed payload on top of those would cut results the caller asked for, so the
 * cap runs only where this module registered the flag itself.
 */
const CAPPED_COMMANDS = new WeakSet<Command>();

/**
 * The output PORT: register a command's action so whatever it RETURNS is
 * rendered in the caller's format, once, here.
 *
 *     emitsResult(
 *       program.command("list").description("…"),
 *       async (options) => ({ data: agents, table: () => { … } }),
 *     );
 *
 * Resolution reads `optsWithGlobals()` off the running command, so a
 * root-position flag (`lw --output json monitor list` — the spelling the help
 * text teaches, since the root's copies are what render under "Global
 * Options:") resolves the same as a trailing one. Commander only puts
 * root-position globals on the ROOT command, so anything reading the leaf's
 * `opts()` silently drops them.
 *
 * A handler returning nothing is fine — commands that legitimately own their
 * own output (interactive login, the gateway wrappers) just return void.
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
 * The other half of the port: mark a command whose action renders the resolved
 * format ITSELF, through `printResult`, instead of returning a `CommandResult`
 * for `emitsResult` to render.
 *
 * These honour the entire contract — every format, `--json` fields, `--jq` —
 * because `printResult` is the same renderer the port uses. They keep the
 * rendering inside the action only because they have work that must follow the
 * output: `trace search` reports telemetry completion and flushes it, and a
 * `--jq` rejection there has to stay a rendering failure rather than a search
 * one. Returning early would reorder both.
 *
 * Registering them here is what makes the format gate honest. The gate asks
 * "can this command honour the format the caller asked for", and for these the
 * answer has always been yes — but the WeakSet only knew about `emitsResult`,
 * so `lw trace search -o json`, `lw commands -o json` and the whole `skills`
 * group were refused with "does not emit structured output yet" while the code
 * underneath demonstrably did. That refusal even pointed the caller at
 * `lw commands`, which was refused for the same reason.
 *
 * Prefer `emitsResult` for anything new — it owns the rendering, so a command
 * cannot get it wrong. This exists for the handful that genuinely cannot return
 * before their output lands.
 */
export const rendersOwnResult = (command: Command): Command => {
  OUTPUT_AWARE_COMMANDS.add(command);
  return command;
};

/** Whether this command's action speaks the output contract. */
export const isOutputAware = (command: Command): boolean =>
  OUTPUT_AWARE_COMMANDS.has(command);

/**
 * Refuse to answer a machine format we cannot actually produce.
 *
 * `registerOutputOptions` puts `-o/--output` on EVERY command, and `choices()`
 * makes a typo fail loudly at parse time. Until a command is migrated to
 * `emitsResult`, a VALID value is the more dangerous case: the flag validates,
 * the command prints its chalk table anyway, and the caller gets human text at
 * exit 0 having explicitly asked for JSON. `--jq` is worse still — the
 * expression is never parsed, so a malformed one also exits 0.
 *
 * So: an EXPLICIT machine format on an unmigrated command is an error, not a
 * table. Agent mode merely detected from the environment is not explicit — the
 * caller asked for nothing, and erroring there would break every unmigrated
 * command the moment it runs under Claude Code — so that case keeps the table
 * and warns on stderr that the output is not machine-readable.
 *
 * Returns the format the request should actually run as.
 */
export const assertFormatIsSupported = async (
  actionCommand: Command,
  resolved: ResolvedOutput,
): Promise<ResolvedOutput> => {
  if (resolved.format === "table" || isOutputAware(actionCommand)) return resolved;

  // A command that defines its OWN non-hidden `--json` (daemon status, the
  // ingest and governance groups) already emits machine output through that
  // flag — it just predates the port. Refusing it would break a working
  // spelling, so bare `--json` passes through.
  //
  // Narrowly, though: owning `--json` proves the command can emit ITS json, not
  // that it can honour every format. `-o yaml` and `--jq` are still beyond it —
  // `daemon status -o yaml` would print JSON, and a `--jq` expression would
  // never be parsed — so those stay refusable. Without this narrowing the
  // bypass also swallows `dataset records add --json '{payload}' -o yaml`,
  // where `--json` is a PAYLOAD flag and nothing about it implies output
  // capability at all.
  if (
    ownsOwnJsonFlag(actionCommand) &&
    actionCommand.optsWithGlobals().output === undefined &&
    actionCommand.optsWithGlobals().jq === undefined
  ) {
    return resolved;
  }

  const raw: RawOutputFlags = actionCommand.optsWithGlobals();
  const name = actionCommand.name();

  // Only the NEW contract flags are refusable. Legacy `-f/--format json` is
  // NOT: unmigrated commands implement it themselves (`if (options.format ===
  // "json")`), so refusing it would break a spelling that has always worked —
  // which is why `hasExplicitFormatRequest` (which counts it) is the wrong
  // predicate here. `-o` and `--jq` never existed before this contract, so a
  // command that cannot honour them has nothing to break.
  //
  // `raw.agent` is deliberately NOT in this list. `--agent` is a MODE, not a
  // format demand — it also means no colour and no spinners, which every
  // command honours whether migrated or not — so it degrades with a warning
  // rather than failing. Adding it here would harden `--agent` into a refusal
  // and break every unmigrated command for the callers most likely to pass it.
  // Pinned by a test; do not "fix" this into the list.
  //
  // A flag the COMMAND owns is not a format demand either. `trace export`
  // defines its own `-o, --output <file>`, so `-o traces.jsonl` is a file path,
  // and reading it here refused that command's own primary spelling under
  // exactly the environment the CLI advertises for agents. Only `--output` is
  // carved out: `--json` keeps the narrower treatment above deliberately —
  // owning it proves the command can emit ITS json, not that it can honour
  // every format, and widening it here would undo that.
  const requestedNewContractFlag =
    (raw.output !== undefined && !ownsOwnOptionFlag(actionCommand, "--output")) ||
    raw.jq !== undefined ||
    raw.json !== undefined;

  if (requestedNewContractFlag) {
    const { commandValidationError, reportCommandError } = await import(
      "./errorOutput.js"
    );
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
    `note: \`${name}\` does not emit structured output yet — the table below is not machine-readable.\n`,
  );
  return { ...resolved, format: "table" };
};

/**
 * Apply the resolved output context to the request's output machinery:
 * the error/spinner path (machine formats fail as structured documents and
 * keep spinners silent — see utils/errorOutput.ts and utils/spinner.ts) and
 * colour (agent mode turns it off). Called once per action from the
 * program's `preAction` hook, so a warm daemon serving one command after
 * another cannot leak one caller's format into the next.
 *
 * Under the daemon these land in the request's AsyncLocalStorage scope, so
 * two concurrent requests in one execution window cannot clobber each other's
 * format or colour (see utils/outputScope.ts).
 *
 * Async because the colour half needs chalk, and chalk is kept off the
 * cold-start path: `disableOutputColor` lives in errorOutput.ts and is
 * imported lazily, only when agent mode actually asks for colour-off. The
 * `preAction` hook awaits this, so the disabler has run before the command's
 * action (and its own chalk imports) executes.
 */
export const applyOutputContext = async (
  resolved: ResolvedOutput,
): Promise<void> => {
  // Machine formats fail as structured documents; agent mode's document is the
  // compact single-line form (see renderErrorAsJson), everything else pretty.
  setOutputFormat(
    resolved.format === "table"
      ? undefined
      : resolved.format === "agents"
        ? "agents"
        : "json",
  );
  if (resolved.agent) {
    const { disableOutputColor } = await import("./errorOutput.js");
    disableOutputColor();
  }
};

/**
 * The global output flags, added to the root program and to every command
 * that does not already define a conflicting one:
 *
 * - commands with their own boolean `--json` (ingest/governance/daemon) keep
 *   it — the bare flag still normalises to json output;
 * - `trace export` keeps its `-o, --output <file>` (a file path, not the
 *   output contract);
 * - the gateway wrappers (claude/codex/cursor/gemini/opencode) are skipped
 *   entirely: they pass unknown options through to the wrapped binary, and
 *   swallowing `--json` there would steal the wrapped tool's own flag.
 */
export const registerOutputOptions = (program: Command): void => {
  const globals: {
    flags: string;
    description: string;
    long: string;
    short?: string;
    choices?: readonly string[];
    /** Register only on commands that answer through the output port. */
    outputAwareOnly?: boolean;
  }[] = [
    {
      flags: "-o, --output <format>",
      description: "Output format: table (default), json, agents (compact single-line JSON), or yaml",
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
      description: "Agent mode: compact JSON output, no colour, no spinners (auto-detected from agent env vars)",
      long: "--agent",
    },
  ];

  const visit = (command: Command, isRoot: boolean): void => {
    // Commander private API: there is no public accessor for
    // allowUnknownOption — re-check on commander upgrades.
    const allowsUnknown = (command as unknown as { _allowUnknownOption?: boolean })
      ._allowUnknownOption === true;

    if (!allowsUnknown) {
      for (const option of globals) {
        const conflicts = command.options.some(
          (existing) =>
            existing.long === option.long ||
            (option.short !== undefined && existing.short === option.short),
        );
        if (conflicts) continue;
        if (option.outputAwareOnly && !OUTPUT_AWARE_COMMANDS.has(command)) continue;
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
    }

    command.commands.forEach((child) => visit(child, false));
  };

  visit(program, true);
};
