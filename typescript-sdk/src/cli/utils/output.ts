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
 *                           (`.items[].name`), and a terminal `| length`. No
 *                           jq dependency.
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
import { disableOutputColor, setOutputFormat } from "./errorOutput";

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
export type OutputFormat = "table" | "json" | "agents" | "yaml";

const OUTPUT_FORMATS: readonly string[] = ["table", "json", "agents", "yaml"];

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
  /** Agent mode is active (flag or env): colour and spinners are off. */
  agent: boolean;
}

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
  if (raw.output !== undefined && OUTPUT_FORMATS.includes(raw.output)) {
    format = raw.output as OutputFormat;
  } else if (raw.json !== undefined || raw.jq !== undefined) {
    format = "json";
  } else if (raw.format === "json") {
    format = "json";
  } else if (agent) {
    format = "agents";
  } else {
    format = "table";
  }

  return { format, ...(fields?.length ? { fields } : {}), ...(raw.jq !== undefined ? { jq: raw.jq } : {}), agent };
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
export const resolveActionOutputOptions = (
  actionCommand: Command,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedOutput => {
  const raw: RawOutputFlags = actionCommand.optsWithGlobals();
  if (
    typeof raw.json === "string" &&
    actionCommand.options.some(
      (option) => option.long === "--json" && !option.hidden,
    )
  ) {
    delete raw.json;
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
 * The tiny built-in jq subset: `.`, `.a.b`, `.items[]`, `.items[].name`, and a
 * terminal `| length` (arrays, strings, objects). Iteration collects into an
 * array, the way `jq '[ .items[].name ]'` reads. Anything else throws — a
 * wrong expression must fail loudly, not silently print `null` into a
 * pipeline.
 */
export const applyJq = (expression: string, data: unknown): unknown => {
  // A terminal pipe operator: `.commands | length`. Handled before the path
  // walk — without this the whole "a | b" string would be looked up as a KEY
  // and silently print null, which is exactly the wrong answer an agent would
  // then build on.
  const pipeIndex = expression.indexOf("|");
  if (pipeIndex !== -1) {
    const path = expression.slice(0, pipeIndex).trim();
    const operator = expression.slice(pipeIndex + 1).trim();
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

  if (!expression.startsWith(".")) {
    throw new Error(
      `Invalid --jq expression "${expression}": must start with "." (supported: dot paths, .items[], .items[].field, | length)`,
    );
  }
  if (expression === ".") return data;

  const segments = expression.slice(1).split(".");
  const apply = (value: unknown, rest: string[], path: string): unknown => {
    const [head, ...tail] = rest;
    if (head === undefined) return value;

    const iterate = head.endsWith("[]");
    const key = iterate ? head.slice(0, -2) : head;
    if (key === "" && !iterate) {
      throw new Error(`Invalid --jq expression "${expression}": empty segment at "${path}"`);
    }

    const descended = key === "" ? value : descend(value, key);
    const at = `${path}.${head}`;

    if (!iterate) {
      if (tail.length === 0) return descended;
      return apply(descended, tail, at);
    }

    if (!Array.isArray(descended)) {
      throw new Error(
        `Invalid --jq expression "${expression}": "${at}" iterates over a non-array value`,
      );
    }
    return descended.map((item) => apply(item, tail, at));
  };

  return apply(data, segments, "");
};

/** `--json <fields>`: pick top-level fields, per item when data is an array. */
const selectFields = (data: unknown, fields: string[]): unknown => {
  const pick = (item: unknown): unknown => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return item;
    }
    const record = item as Record<string, unknown>;
    return Object.fromEntries(fields.map((field) => [field, record[field] ?? null]));
  };
  return Array.isArray(data) ? data.map(pick) : pick(data);
};

const serialize = async (data: unknown, format: OutputFormat): Promise<string> => {
  if (format === "json") return JSON.stringify(data, null, 2);
  if (format === "agents") return JSON.stringify(data);
  // js-yaml's dump already ends in "\n"; trim it so console.log adds exactly one.
  return (await loadYaml()).dump(data).replace(/\n$/, "");
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

  let out = data;
  if (resolved.fields) out = selectFields(out, resolved.fields);
  if (resolved.jq) out = applyJq(resolved.jq, out);

  console.log(await serialize(out, resolved.format));
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
 * format or colour (see utils/errorOutput.ts).
 */
export const applyOutputContext = (resolved: ResolvedOutput): void => {
  setOutputFormat(resolved.format === "table" ? undefined : "json");
  if (resolved.agent) disableOutputColor();
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
      description: "Filter output with a path expression (e.g. .traces[].traceId)",
      long: "--jq",
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
