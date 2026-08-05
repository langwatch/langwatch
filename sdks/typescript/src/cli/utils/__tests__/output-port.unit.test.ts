/**
 * The output PORT, pinned: a command returns data, the port picks the format.
 *
 * Every test here covers a way the CLI could answer a machine caller with
 * human text — or with a fabricated value — at exit 0. That class of bug is
 * invisible to the caller by construction, so it has to be invisible to the
 * test suite too or it comes straight back.
 *
 * The gate that REFUSES a format a command cannot serve is a separate concern
 * and lives in `output-format-gate.unit.test.ts`; the `--jq` subset lives in
 * `output-jq.unit.test.ts`; the wiring into the real tree lives in
 * `output-command-tree.unit.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { isOutputAware, registerOutputOptions, emitsResult } from "../output";
import { installOutputHarness } from "./output-harness";

const { logged } = installOutputHarness();

/** A program shaped like the real one: positional options, globals registered. */
const buildProgram = (register: (program: Command) => void): Command => {
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
