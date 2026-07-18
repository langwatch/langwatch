/**
 * The output contract, pinned: one helper, every format, and the flag
 * normalisation that keeps the legacy spellings (`-f/--format`, bare
 * `--json`) working on top of the new one (`-o/--output`, `--json <fields>`,
 * `--jq`, `--agent`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import chalk from "chalk";
import {
  AGENT_MODE_ENV_VARS,
  applyJq,
  applyOutputContext,
  isAgentModeEnv,
  printResult,
  registerOutputOptions,
  resolveActionOutputOptions,
  resolveOutputOptions,
} from "../output";
import { getOutputFormat } from "../errorOutput";

const DATA = [
  { name: "alpha", id: "1", nested: { score: 0.9 } },
  { name: "beta", id: "2", nested: { score: 0.1 } },
];

/** Agent-mode env vars from the host (e.g. CLAUDECODE under Claude Code) must not leak into tests. */
let savedAgentEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedAgentEnv = Object.fromEntries(
    AGENT_MODE_ENV_VARS.map((name) => [name, process.env[name]]),
  );
  for (const name of AGENT_MODE_ENV_VARS) delete process.env[name];
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  for (const name of AGENT_MODE_ENV_VARS) {
    const value = savedAgentEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.restoreAllMocks();
});

const printedJson = (): unknown =>
  JSON.parse(vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join("\n"));

describe("printResult", () => {
  describe("given no output flags", () => {
    it("renders the human table callback and prints nothing itself", async () => {
      const table = vi.fn();

      await printResult(DATA, { table });

      expect(table).toHaveBeenCalledOnce();
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe("given -o json", () => {
    it("prints pretty 2-space JSON", async () => {
      await printResult(DATA, { output: "json", table: vi.fn() });

      expect(console.log).toHaveBeenCalledWith(JSON.stringify(DATA, null, 2));
    });
  });

  describe("given -o agents", () => {
    it("prints compact single-line JSON", async () => {
      await printResult(DATA, { output: "agents", table: vi.fn() });

      expect(console.log).toHaveBeenCalledWith(JSON.stringify(DATA));
    });
  });

  describe("given -o yaml", () => {
    it("prints YAML", async () => {
      await printResult({ name: "alpha", tags: ["a", "b"] }, { output: "yaml", table: vi.fn() });

      expect(console.log).toHaveBeenCalledWith("name: alpha\ntags:\n  - a\n  - b");
    });
  });

  describe("given --json with a field list", () => {
    it("selects those fields from every item of an array", async () => {
      await printResult(DATA, { json: "name, id ", table: vi.fn() });

      expect(printedJson()).toEqual([
        { name: "alpha", id: "1" },
        { name: "beta", id: "2" },
      ]);
    });

    it("selects fields from a single object, null-filling the missing", async () => {
      await printResult(DATA[0], { json: "name,missing", table: vi.fn() });

      expect(printedJson()).toEqual({ name: "alpha", missing: null });
    });

    it("passes scalars through untouched", async () => {
      await printResult([1, "two"], { json: "name", table: vi.fn() });

      expect(printedJson()).toEqual([1, "two"]);
    });
  });

  describe("given --jq", () => {
    it("resolves a dot path", async () => {
      await printResult({ a: { b: 42 } }, { jq: ".a.b", table: vi.fn() });

      expect(printedJson()).toBe(42);
    });

    it("iterates an array with .items[]", async () => {
      await printResult({ items: DATA }, { jq: ".items[]", table: vi.fn() });

      expect(printedJson()).toEqual(DATA);
    });

    it("iterates and selects a field with .items[].name", async () => {
      await printResult({ items: DATA }, { jq: ".items[].name", table: vi.fn() });

      expect(printedJson()).toEqual(["alpha", "beta"]);
    });

    it("applies after --json field selection, like gh", async () => {
      await printResult(DATA, { json: "name", jq: ".[].name", table: vi.fn() });

      expect(printedJson()).toEqual(["alpha", "beta"]);
    });

    it("throws on an expression that does not start with a dot", async () => {
      await expect(
        printResult(DATA, { jq: "items[]", table: vi.fn() }),
      ).rejects.toThrow(/must start with/);
    });

    it("throws when iterating a non-array", async () => {
      await expect(
        printResult({ items: 42 }, { jq: ".items[]", table: vi.fn() }),
      ).rejects.toThrow(/non-array/);
    });
  });
});

describe("applyJq", () => {
  it("treats a bare dot as the identity", () => {
    expect(applyJq(".", DATA)).toEqual(DATA);
  });

  it("answers null where jq would, on a missing path", () => {
    expect(applyJq(".a.b", { a: null })).toBeNull();
  });

  it("supports a terminal | length on arrays, strings, and objects", () => {
    expect(applyJq(".items | length", { items: [1, 2, 3] })).toBe(3);
    expect(applyJq(".name | length", { name: "langwatch" })).toBe(9);
    expect(applyJq(". | length", { a: 1, b: 2 })).toBe(2);
    // Iteration collects first (`.items[].tags` → array of tag arrays), then
    // `| length` sizes the collected result — the subset's documented reading.
    expect(applyJq(".items[].tags | length", {
      items: [{ tags: ["a", "b"] }, { tags: [] }],
    })).toBe(2);
  });

  it("throws on unsupported pipes instead of silently printing null", () => {
    expect(() => applyJq(".items | map(.name)", { items: [] })).toThrow(
      /\| length/,
    );
    expect(() => applyJq(".items | length | length", { items: [] })).toThrow(
      /\| length/,
    );
    expect(() => applyJq(".items | length", { items: 42 })).toThrow(/no size/);
  });

  it("throws on | length of a missing path (jq proper answers 0 there)", () => {
    // The path walk resolves a missing key to null (jq-like), but the subset's
    // `| length` only sizes strings/arrays/objects — null has no size, so this
    // throws rather than answering 0 the way `jq '.missing | length'` would.
    // Pinned so a future alignment with jq is a deliberate test change.
    expect(() => applyJq(".missing | length", {})).toThrow(/no size/);
  });
});

describe("resolveOutputOptions flag normalisation", () => {
  describe("given the legacy spellings", () => {
    it("maps -f/--format json onto json", () => {
      expect(resolveOutputOptions({ format: "json" }).format).toBe("json");
    });

    it("maps the bare boolean --json onto json", () => {
      expect(resolveOutputOptions({ json: true }).format).toBe("json");
    });

    it("keeps legacy human spellings (digest, table, jsonl) on the table", () => {
      expect(resolveOutputOptions({ format: "digest" }).format).toBe("table");
      expect(resolveOutputOptions({ format: "table" }).format).toBe("table");
      expect(resolveOutputOptions({ format: "jsonl" }).format).toBe("table");
    });

    it("ignores an -o value that is not a format (trace export's file path)", () => {
      // The contract's -o flag itself rejects unknown values at parse time
      // (choices — see the registerOutputOptions tests below). This leniency
      // is still load-bearing for `trace export`: its own `-o, --output
      // <file>` wins the conflict check in registerOutputOptions, and the
      // preAction hook feeds EVERY command's options through this function.
      expect(resolveOutputOptions({ output: "out.csv", format: "jsonl" }).format).toBe("table");
    });
  });

  describe("given the new contract", () => {
    it("lets -o/--output beat the legacy -f/--format", () => {
      expect(resolveOutputOptions({ output: "json", format: "table" }).format).toBe("json");
    });

    it("implies json from --json <fields> and splits the list", () => {
      const resolved = resolveOutputOptions({ json: "name, id" });

      expect(resolved.format).toBe("json");
      expect(resolved.fields).toEqual(["name", "id"]);
    });

    it("implies json from --jq", () => {
      expect(resolveOutputOptions({ jq: ".items[]" }).format).toBe("json");
    });

    it("accepts every contract format via -o", () => {
      for (const format of ["table", "json", "agents", "yaml"] as const) {
        expect(resolveOutputOptions({ output: format }).format).toBe(format);
      }
    });
  });

  describe("given nothing at all", () => {
    it("defaults to the human table", () => {
      expect(resolveOutputOptions({}).format).toBe("table");
    });
  });
});

describe("agent-mode detection", () => {
  it.each(AGENT_MODE_ENV_VARS.map((name) => [name]))(
    "activates on the %s env var",
    (name) => {
      expect(isAgentModeEnv({ [name]: "1" })).toBe(true);
      expect(resolveOutputOptions({}, { [name]: "1" }).format).toBe("agents");
    },
  );

  it("ignores env values that mean 'off'", () => {
    for (const value of ["", "0", "false"]) {
      expect(isAgentModeEnv({ CLAUDECODE: value })).toBe(false);
    }
  });

  it("activates on the --agent flag without any env var", () => {
    const resolved = resolveOutputOptions({ agent: true }, {});

    expect(resolved.agent).toBe(true);
    expect(resolved.format).toBe("agents");
  });

  it("lets an explicit -o beat the agent default", () => {
    const resolved = resolveOutputOptions({ agent: true, output: "yaml" }, {});

    expect(resolved.format).toBe("yaml");
    expect(resolved.agent).toBe(true);
  });

  it("lets an explicit --json/-f json beat the agent default", () => {
    expect(resolveOutputOptions({ agent: true, json: true }, {}).format).toBe("json");
    expect(resolveOutputOptions({ agent: true, format: "json" }, {}).format).toBe("json");
  });
});

describe("applyOutputContext", () => {
  let savedLevel: typeof chalk.level;

  beforeEach(() => {
    savedLevel = chalk.level;
  });

  afterEach(() => {
    chalk.level = savedLevel;
    applyOutputContext(resolveOutputOptions({}, {}));
  });

  it("turns colour off and marks output as machine in agent mode", () => {
    applyOutputContext(resolveOutputOptions({ agent: true }, {}));

    expect(chalk.level).toBe(0);
    expect(getOutputFormat()).toBe("json");
  });

  it("marks every machine format (json/agents/yaml) as json for the error path", () => {
    for (const format of ["json", "agents", "yaml"] as const) {
      applyOutputContext(resolveOutputOptions({ output: format }, {}));
      expect(getOutputFormat()).toBe("json");
    }
  });

  it("keeps the human default untouched", () => {
    applyOutputContext(resolveOutputOptions({}, {}));

    expect(chalk.level).toBe(savedLevel);
    expect(getOutputFormat()).toBe("text");
  });
});

describe("registerOutputOptions", () => {
  const build = () => {
    const program = new Command();
    program.enablePositionalOptions().passThroughOptions();
    return program;
  };

  it("makes the global flags parse AFTER a subcommand", () => {
    const program = build();
    let captured: Record<string, unknown> = {};
    program
      .command("trace")
      .command("list")
      .action((opts: Record<string, unknown>, cmd: Command) => {
        captured = cmd.optsWithGlobals();
      });

    registerOutputOptions(program);
    program.parse(["node", "lw", "trace", "list", "--agent", "-o", "yaml", "--jq", ".items[]"]);

    expect(captured).toMatchObject({ agent: true, output: "yaml", jq: ".items[]" });
  });

  it("makes the global flags parse BEFORE a subcommand too", () => {
    const program = build();
    let captured: Record<string, unknown> = {};
    program
      .command("status")
      .action((opts: Record<string, unknown>, cmd: Command) => {
        captured = cmd.optsWithGlobals();
      });

    registerOutputOptions(program);
    program.parse(["node", "lw", "--agent", "status"]);

    expect(captured).toMatchObject({ agent: true });
  });

  it("keeps a command's own boolean --json and file-valued -o/--output", () => {
    const program = build();
    let captured: Record<string, unknown> = {};
    program
      .command("export")
      .option("-o, --output <file>", "Write output to file instead of stdout")
      .option("--json", "emit machine-readable JSON")
      .action((opts: Record<string, unknown>) => {
        captured = opts;
      });

    registerOutputOptions(program);
    program.parse(["node", "lw", "export", "--json", "-o", "out.jsonl"]);

    expect(captured).toEqual({ output: "out.jsonl", json: true });
  });

  it("does not add flags to pass-through wrapper commands", () => {
    const program = build();
    const wrapped = program
      .command("claude")
      .allowUnknownOption(true)
      .allowExcessArguments(true)
      .action(() => undefined);

    registerOutputOptions(program);

    expect(wrapped.options).toHaveLength(0);
  });

  it("rejects an -o value that is not a contract format", () => {
    const program = build();
    // exitOverride/configureOutput must precede .command(): commander copies
    // inherited settings to subcommands at creation time.
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    program.command("status").action(() => undefined);

    registerOutputOptions(program);

    expect(() =>
      program.parse(["node", "lw", "status", "-o", "jsn"]),
    ).toThrow(/Allowed choices are table, json, agents, yaml/);
  });

  it("does not constrain a command's own -o (trace export's file path)", () => {
    const program = build();
    let captured: Record<string, unknown> = {};
    program
      .command("export")
      .option("-o, --output <file>", "Write output to file instead of stdout")
      .action((opts: Record<string, unknown>) => {
        captured = opts;
      });

    registerOutputOptions(program);
    program.parse(["node", "lw", "export", "-o", "out.csv"]);

    expect(captured).toEqual({ output: "out.csv" });
  });
});

describe("resolveActionOutputOptions", () => {
  it("does not read a command's own --json <json> PAYLOAD as machine-output intent", () => {
    // The `dataset records update` shape: a required --json that carries a
    // JSON document, plus a legacy -f with a human default. A plain human
    // caller must keep human errors and spinning spinners.
    const program = new Command();
    program.enablePositionalOptions().passThroughOptions();
    const update = program
      .command("update")
      .requiredOption("--json <json>", "JSON object with updated fields")
      .option("-f, --format <format>", "Output format: text (default) or json", "text")
      .action(() => undefined);

    registerOutputOptions(program);
    program.parse(["node", "lw", "update", "--json", '{"name":"x"}']);

    const resolved = resolveActionOutputOptions(update, {});
    expect(resolved.format).toBe("table");
    expect(resolved.fields).toBeUndefined();
  });

  it("still reads the contract's (hidden) --json <fields> on commands without their own --json", () => {
    const program = new Command();
    program.enablePositionalOptions().passThroughOptions();
    const list = program.command("list").action(() => undefined);

    registerOutputOptions(program);
    program.parse(["node", "lw", "list", "--json", "name,id"]);

    const resolved = resolveActionOutputOptions(list, {});
    expect(resolved.format).toBe("json");
    expect(resolved.fields).toEqual(["name", "id"]);
  });

  it("still normalises a command's own bare boolean --json onto json", () => {
    const program = new Command();
    program.enablePositionalOptions().passThroughOptions();
    const ingest = program
      .command("ingest")
      .option("--json", "emit machine-readable JSON")
      .action(() => undefined);

    registerOutputOptions(program);
    program.parse(["node", "lw", "ingest", "--json"]);

    expect(resolveActionOutputOptions(ingest, {}).format).toBe("json");
  });
});
