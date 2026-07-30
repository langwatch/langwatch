/**
 * The output contract's COMMANDER half, pinned: `registerOutputOptions`
 * adding the global flags to every command without stealing a command's own,
 * and `resolveActionOutputOptions` reading the running command's resolved
 * context in the preAction hook.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import {
  AGENT_MODE_ENV_VARS,
  registerOutputOptions,
  resolveActionOutputOptions,
} from "../output";

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
