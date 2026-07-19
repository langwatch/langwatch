/**
 * The output PORT, pinned: a command returns data, the port picks the format.
 *
 * Every test here covers a way the CLI could answer a machine caller with
 * human text — or with a fabricated value — at exit 0. That class of bug is
 * invisible to the caller by construction, so it has to be invisible to the
 * test suite too or it comes straight back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import {
  AGENT_MODE_ENV_VARS,
  applyJq,
  assertFormatIsSupported,
  isOutputAware,
  registerOutputOptions,
  resolveActionOutputOptions,
  emitsResult,
} from "../output";

let savedAgentEnv: Record<string, string | undefined> = {};
let logged: string[] = [];
let warned: string[] = [];
let exited: number[] = [];

beforeEach(() => {
  savedAgentEnv = Object.fromEntries(
    AGENT_MODE_ENV_VARS.map((name) => [name, process.env[name]]),
  );
  for (const name of AGENT_MODE_ENV_VARS) delete process.env[name];
  logged = [];
  warned = [];
  exited = [];
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exited.push(code ?? 0);
    return undefined as never;
  }) as never);
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    warned.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  for (const name of AGENT_MODE_ENV_VARS) {
    const value = savedAgentEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.restoreAllMocks();
});

/** A program shaped like the real one: positional options, globals registered. */
const buildProgram = (
  register: (program: Command) => void,
): Command => {
  const program = new Command();
  program.exitOverride().enablePositionalOptions().passThroughOptions();
  register(program);
  registerOutputOptions(program);
  return program;
};

describe("emitsResult", () => {
  const PAYLOAD = [
    { id: "a1", name: "first", config: { evaluatorType: "llm" } },
    { id: "b2", name: "second", config: { evaluatorType: "regex" } },
  ];

  const registerListing = (program: Command): void => {
    emitsResult(program.command("list"), () => ({
      data: PAYLOAD,
      table: () => console.log("HUMAN TABLE"),
    }));
  };

  describe("when no format is requested", () => {
    it("renders the human table", async () => {
      const program = buildProgram(registerListing);
      await program.parseAsync(["list"], { from: "user" });
      expect(logged).toEqual(["HUMAN TABLE"]);
    });
  });

  describe("when a machine format is requested after the subcommand", () => {
    it("serializes the data instead of the table", async () => {
      const program = buildProgram(registerListing);
      await program.parseAsync(["list", "--output", "json"], { from: "user" });
      expect(logged.join("")).not.toContain("HUMAN TABLE");
      expect(JSON.parse(logged[0]!)).toEqual(PAYLOAD);
    });
  });

  // The regression that motivated the port: commander only puts root-position
  // globals on the ROOT command, so anything reading the leaf's opts() drops
  // them — and `lw --output json monitor list` is the spelling the help text
  // teaches, since the root's copies are what render under "Global Options:".
  describe("when a machine format is requested BEFORE the subcommand", () => {
    it("serializes the data, exactly as the trailing spelling does", async () => {
      const program = buildProgram(registerListing);
      await program.parseAsync(["--output", "json", "list"], { from: "user" });
      expect(logged.join("")).not.toContain("HUMAN TABLE");
      expect(JSON.parse(logged[0]!)).toEqual(PAYLOAD);
    });

    it("honours a root-position --agent with compact single-line JSON", async () => {
      const program = buildProgram(registerListing);
      await program.parseAsync(["--agent", "list"], { from: "user" });
      expect(logged).toHaveLength(1);
      expect(logged[0]).not.toContain("\n");
      expect(JSON.parse(logged[0]!)).toEqual(PAYLOAD);
    });
  });

  describe("when --json selects fields", () => {
    it("projects dotted paths rather than null-filling them", async () => {
      const program = buildProgram(registerListing);
      await program.parseAsync(["list", "--json", "name,config.evaluatorType"], {
        from: "user",
      });
      expect(JSON.parse(logged[0]!)).toEqual([
        { name: "first", "config.evaluatorType": "llm" },
        { name: "second", "config.evaluatorType": "regex" },
      ]);
    });
  });

  describe("when the handler returns nothing", () => {
    it("prints nothing and does not throw", async () => {
      const program = buildProgram((p) => {
        emitsResult(p.command("noop"), () => undefined);
      });
      await program.parseAsync(["noop"], { from: "user" });
      expect(logged).toEqual([]);
    });
  });
});

describe("isOutputAware", () => {
  it("tells a migrated command from one that prints its own output", () => {
    const program = new Command();
    const migrated = emitsResult(program.command("migrated"), () => ({
      data: {},
      table: () => undefined,
    }));
    const legacy = program.command("legacy").action(() => undefined);

    expect(isOutputAware(migrated)).toBe(true);
    expect(isOutputAware(legacy)).toBe(false);
  });
});

describe("assertFormatIsSupported", () => {
  const legacyCommand = (): Command => {
    const program = new Command();
    program.enablePositionalOptions().passThroughOptions();
    const legacy = program.command("legacy").action(() => undefined);
    registerOutputOptions(program);
    return legacy;
  };

  describe("given a command that does not emit structured output", () => {
    describe("when a machine format was explicitly requested", () => {
      it("refuses instead of answering with a human table", async () => {
        const legacy = legacyCommand();
        legacy.setOptionValue("output", "json");

        await assertFormatIsSupported(legacy, resolveActionOutputOptions(legacy));

        expect(exited).toEqual([1]);
        // Rendered as the human block on stderr here: no output scope has been
        // applied in this unit, so errorOutput takes its non-machine path.
        expect(warned.join("") + logged.join("")).toContain("does not emit structured output");
      });

      it("refuses a --jq expression it would otherwise never parse", async () => {
        const legacy = legacyCommand();
        legacy.setOptionValue("jq", ".anything[0]");

        await assertFormatIsSupported(legacy, resolveActionOutputOptions(legacy));

        expect(exited).toEqual([1]);
      });

      // Legacy `-f/--format json` predates the contract and unmigrated
      // commands implement it themselves, so refusing it would break a
      // spelling that has always worked.
      it("still honours the legacy --format json it has always supported", async () => {
        const legacy = legacyCommand();
        legacy.setOptionValue("format", "json");

        const effective = await assertFormatIsSupported(
          legacy,
          resolveActionOutputOptions(legacy),
        );

        expect(exited).toEqual([]);
        expect(effective.format).toBe("json");
      });

      // Owning `--json` proves the command can emit ITS json — not that it can
      // honour every format. Without this narrowing, `daemon status -o yaml`
      // and `dataset records add --json '{..}' -o yaml` both answered with a
      // chalk table at exit 0 for a caller who explicitly asked for YAML.
      it.each([
        ["output", "yaml"],
        ["jq", ".foo"],
      ])("still refuses --%s from a command that only owns --json", async (flag, value) => {
        const program = new Command();
        program.enablePositionalOptions().passThroughOptions();
        const owner = program
          .command("owner")
          .option("--json", "emit machine-readable JSON")
          .action(() => undefined);
        registerOutputOptions(program);
        owner.setOptionValue(flag, value);

        await assertFormatIsSupported(owner, resolveActionOutputOptions(owner));

        expect(exited).toEqual([1]);
      });

      // `--json <payload>` on dataset records add/update is DATA, not an
      // output-capability claim, so an explicit -o must still be refused.
      it("refuses an explicit format when --json is the command's payload flag", async () => {
        const program = new Command();
        program.enablePositionalOptions().passThroughOptions();
        const payload = program
          .command("records-add")
          .option("--json <json>", "the records to add")
          .action(() => undefined);
        registerOutputOptions(program);
        payload.setOptionValue("json", '{"a":1}');
        payload.setOptionValue("output", "yaml");

        await assertFormatIsSupported(payload, resolveActionOutputOptions(payload));

        expect(exited).toEqual([1]);
      });

      // `--agent` is a MODE (no colour, no spinners), not a format demand, so
      // it degrades with a warning instead of failing. Pins the deliberate
      // omission of `raw.agent` from the refusal check.
      it("degrades rather than refusing an explicit --agent", async () => {
        const legacy = legacyCommand();
        legacy.setOptionValue("agent", true);

        const effective = await assertFormatIsSupported(
          legacy,
          resolveActionOutputOptions(legacy),
        );

        expect(exited).toEqual([]);
        expect(effective.format).toBe("table");
        expect(warned.join("")).toContain("not machine-readable");
      });

      // daemon status / ingest / governance own a boolean --json and emit
      // machine output through it.
      it("passes through a command that owns its own --json flag", async () => {
        const program = new Command();
        program.enablePositionalOptions().passThroughOptions();
        const owner = program
          .command("owner")
          .option("--json", "emit machine-readable JSON")
          .action(() => undefined);
        registerOutputOptions(program);
        owner.setOptionValue("json", true);

        const effective = await assertFormatIsSupported(
          owner,
          resolveActionOutputOptions(owner),
        );

        expect(exited).toEqual([]);
        expect(effective.format).toBe("json");
      });
    });

    // Erroring here would break every unmigrated command the moment it runs
    // under Claude Code, which sets CLAUDECODE unconditionally.
    describe("when agent mode was only detected from the environment", () => {
      it("keeps the human table but warns it is not machine-readable", async () => {
        process.env.CLAUDECODE = "1";
        const legacy = legacyCommand();
        const resolved = resolveActionOutputOptions(legacy);

        const effective = await assertFormatIsSupported(legacy, resolved);

        expect(resolved.format).toBe("agents");
        expect(effective.format).toBe("table");
        expect(warned.join("")).toContain("not machine-readable");
      });
    });
  });

  describe("given a migrated command", () => {
    it("passes the requested format through untouched", async () => {
      const program = new Command();
      program.enablePositionalOptions().passThroughOptions();
      const migrated = emitsResult(program.command("migrated"), () => ({
        data: {},
        table: () => undefined,
      }));
      registerOutputOptions(program);
      migrated.setOptionValue("output", "json");

      const resolved = resolveActionOutputOptions(migrated);
      const effective = await assertFormatIsSupported(migrated, resolved);

      expect(effective.format).toBe("json");
      expect(warned).toEqual([]);
    });
  });
});

describe("applyJq", () => {
  const DATA = {
    traces: [
      { traceId: "t1", spans: [{ id: "s1" }, { id: "s2" }] },
      { traceId: "t2", spans: [{ id: "s3" }] },
    ],
  };

  describe("when the expression is supported", () => {
    it("walks a dot path", () => {
      expect(applyJq(".traces", DATA)).toEqual(DATA.traces);
    });

    it("collects an iterated field", () => {
      expect(applyJq(".traces[].traceId", DATA)).toEqual(["t1", "t2"]);
    });

    // jq's `[ .a[].b[] ]` collects; it does not nest.
    it("flattens chained iteration rather than nesting it", () => {
      expect(applyJq(".traces[].spans[].id", DATA)).toEqual(["s1", "s2", "s3"]);
    });

    it("counts with a terminal length pipe", () => {
      expect(applyJq(".traces | length", DATA)).toBe(2);
    });
  });

  // Each of these previously walked as a literal key, missed, and returned
  // null at exit 0 — a fabricated answer the caller then builds on. Array
  // indexing is the first thing anyone tries after reading the flag's own
  // `.traces[].traceId` example, so it must fail loudly.
  describe("when the expression uses syntax this subset does not implement", () => {
    it.each([
      [".traces[0]"],
      [".traces[0].traceId"],
      ['.["traces"]'],
      [".traces[]?"],
      [".[0]"],
      [".traces[].spans[0]"],
      // Operators: a denylist missed these and answered `null` silently.
      [".traces - 1"],
      [".traces,.other"],
      [".traces + 1"],
      [".traces(x)"],
    ])("throws rather than answering null for %s", (expression) => {
      expect(() => applyJq(expression, DATA)).toThrow(/unsupported syntax|must start with/);
    });
  });

  // Root-level iteration has an empty key by design; the allowlist must not
  // mistake that for invalid syntax (it did, briefly).
  describe("when iterating at the root", () => {
    it("iterates a top-level array with .[]", () => {
      expect(applyJq(".[]", [{ id: "a" }, { id: "b" }])).toEqual([
        { id: "a" },
        { id: "b" },
      ]);
    });

    it("selects a field under root iteration with .[].id", () => {
      expect(applyJq(".[].id", [{ id: "a" }, { id: "b" }])).toEqual(["a", "b"]);
    });
  });

  describe("when a key is genuinely absent", () => {
    it("still answers null, the way jq does", () => {
      expect(applyJq(".nope", DATA)).toBeNull();
    });
  });
});

/**
 * The port wired into the REAL command tree. The unit tests above prove the
 * mechanism; this proves it is actually connected — a migration that converts
 * an implementation but forgets its `emitsResult` registration would leave the
 * command silently unmigrated, which is precisely the state this work exists
 * to end.
 */
describe("the real command tree", () => {
  // buildProgram() reads the tsup-injected __CLI_VERSION__ build constant,
  // which no test runner defines (see help-topic.unit.test.ts).
  (globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

  const findCommand = (root: Command, path: string[]): Command | undefined =>
    path.reduce<Command | undefined>(
      (cmd, name) => cmd?.commands.find((child) => child.name() === name),
      root,
    );

  it("marks a migrated command as speaking the output contract", async () => {
    const { buildProgram } = await import("../../program.js");
    const listing = findCommand(buildProgram(), ["agent", "list"]);

    expect(listing).toBeDefined();
    expect(isOutputAware(listing!)).toBe(true);
  });

  /**
   * The registration is the ONLY thing that marks a command output-aware —
   * migrating an implementation to return a CommandResult does nothing on its
   * own, and a registration left on `.action(` fails silently for `table`
   * callers while refusing `-o json`. So the wiring is asserted here, per
   * group, rather than trusted.
   */
  describe("when a command group has been wired to the port", () => {
    const wired = [
      ["monitor", "list"],
      ["monitor", "create"],
      ["evaluator", "get"],
      ["graph", "update"],
      ["agent", "run"],
      ["dashboard", "create"],
      ["annotation", "create"],
      ["api-keys", "revoke"],
      ["projects", "update"],
      ["model-provider", "set"],
      ["model-default", "unset"],
      ["gateway-budgets", "archive"],
      ["virtual-keys", "rotate"],
      ["analytics", "query"],
      ["trigger", "delete"],
      ["secret", "update"],
    ];

    it.each(wired)("marks `%s %s` as speaking the output contract", async (group, name) => {
      const { buildProgram } = await import("../../program.js");
      const command = findCommand(buildProgram(), [group, name]);

      expect(command).toBeDefined();
      expect(isOutputAware(command!)).toBe(true);
    });
  });

  describe("when a command still prints its own output", () => {
    const unmigrated = [
      ["prompt", "list"],
      ["dataset", "list"],
      ["workflow", "list"],
      ["experiment", "list"],
    ];

    it.each(unmigrated)("leaves `%s %s` unmarked", async (group, name) => {
      const { buildProgram } = await import("../../program.js");
      const command = findCommand(buildProgram(), [group, name]);

      expect(command).toBeDefined();
      expect(isOutputAware(command!)).toBe(false);
    });
  });
});
