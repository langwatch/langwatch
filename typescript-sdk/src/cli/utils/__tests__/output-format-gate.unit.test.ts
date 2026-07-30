/**
 * The gate that decides whether a command may answer in the format it was
 * asked for — `assertFormatIsSupported`.
 *
 * The failure this exists to prevent is a command that cannot serialize
 * anything quietly rendering a chalk table at exit 0 for a caller who asked for
 * JSON. Refusing is the only honest answer, so the interesting cases here are
 * the ones where refusing would be WRONG: the legacy `-f json` spelling that
 * has always worked, a command that owns its own `--json`, and agent mode
 * detected from the environment rather than demanded on the command line.
 *
 * Split out of `output-port.unit.test.ts`, which pins the port itself.
 */
import { describe, it, expect } from "vitest";
import { Command } from "commander";
import {
  assertFormatIsSupported,
  registerOutputOptions,
  resolveActionOutputOptions,
  emitsResult,
} from "../output";
import { installOutputHarness } from "./output-harness";

const { logged, warned, exited } = installOutputHarness();

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
