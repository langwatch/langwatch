import type { Command } from "commander";
/**
 * The port wired into the REAL command tree: proves it is connected, since a
 * migration that forgets `emitsResult` registration would leave a command
 * silently unmigrated. Split from `output-port.unit.test.ts`.
 */
import { describe, it, expect } from "vitest";

import { assertFormatIsSupported, isOutputAware, resolveActionOutputOptions } from "../output";
import { installOutputHarness } from "./output-harness";

const { warned } = installOutputHarness();

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
   * Registration is the ONLY thing that marks a command output-aware; a
   * registration left on `.action(` fails silently for `table` callers while
   * refusing `-o json`. So the wiring is asserted here, per group.
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
      ["query", "run"],
      ["query", "schema"],
      ["query", "reference"],
      ["query", "examples"],
      ["trace", "facets"],
      ["trace", "fields"],
      ["trigger", "delete"],
      ["secret", "update"],
      ["run-plan", "run"],
      ["test-suite", "run"],
      ["scenario", "run"],
    ];

    it.each(wired)("marks `%s %s` as speaking the output contract", async (group, name) => {
      const { buildProgram } = await import("../../program.js");
      const command = findCommand(buildProgram(), [group, name]);

      expect(command).toBeDefined();
      expect(isOutputAware(command!)).toBe(true);
    });
  });

  describe("when a command still prints its own output", () => {
    // The command that legitimately still prints its own output because a
    // format-blind port cannot serve it: a raw byte stream.
    const unmigrated = [["dataset", "download"]];

    it.each(unmigrated)("leaves `%s %s` unmarked", async (group, name) => {
      const { buildProgram } = await import("../../program.js");
      const command = findCommand(buildProgram(), [group, name]);

      expect(command).toBeDefined();
      expect(isOutputAware(command!)).toBe(false);
    });
  });

  describe("when a command deliberately emits nothing at all", () => {
    /**
     * The session context hook runs as a coding agent's own hook, printing
     * nothing in any format. Registration keeps agent mode from annotating
     * every session start/stop with a note about a table that doesn't exist.
     */
    it("marks `ingest hook` as speaking the output contract", async () => {
      const { buildProgram } = await import("../../program.js");
      const command = findCommand(buildProgram(), ["ingest", "hook"]);

      expect(command).toBeDefined();
      expect(isOutputAware(command!)).toBe(true);
    });
  });

  describe("when a tool wrapper runs inside a coding agent", () => {
    /** @scenario "A wrapper run inside a coding agent prints no table note" */
    it("prints no note about a table for any wrapper", async () => {
      const { buildProgram, TOOL_WRAPPER_COMMANDS } = await import("../../program.js");
      const root = buildProgram();
      process.env.CLAUDECODE = "1";

      for (const tool of TOOL_WRAPPER_COMMANDS) {
        const wrapper = findCommand(root, [tool]);
        expect(wrapper, tool).toBeDefined();
        await assertFormatIsSupported(wrapper!, resolveActionOutputOptions(wrapper!));
      }

      expect(warned.join("")).not.toContain("not machine-readable");
    });
  });

  /**
   * The exhaustive counterpart to the lists above: every leaf in the real
   * tree must be wired to the port or named here as a deliberate holdout, so
   * a new command forces that decision rather than silently missing both.
   */

  /**
   * `-o json` is current, but `-f/--format json` is what skills put in front
   * of agents; Commander rejects an undeclared option before the output
   * preprocessor runs, so the flag must be declared per command.
   */
  describe("when inspecting the commands an agent drives the open page with", () => {
    const agentDriven = [
      ["ui", "call"],
      ["ui", "actions"],
      ["workbench", "get-state"],
    ];

    it.each(agentDriven)(
      "lets `%s %s` be asked for json the way the skills ask",
      async (group, name) => {
        const { buildProgram } = await import("../../program.js");
        const command = findCommand(buildProgram(), [group, name]);

        expect(command).toBeDefined();
        expect(command!.options.map((option) => option.long)).toContain("--format");
      },
    );
  });

  describe("when checking every leaf command", () => {
    /** Leaf path -> why the port cannot serve it. */
    const holdouts = new Map<string, string>([
      // Raw byte stream / file destination: the payload is not a document.
      ["dataset download", "streams raw bytes to a file or stdout"],
      ["trace export", "writes its own jsonl/csv/json, to a file when asked"],

      // A live session that runs until Ctrl-C: it produces status prose and
      // exits via process.exit, never a result document.
      ["agent tunnel", "live tunnel session until Ctrl-C, no result document"],
      // Hidden compatibility name for `agent tunnel`, same wiring.
      ["agent dev", "live tunnel session until Ctrl-C, no result document"],

      // Opens the browser and owns no result document.
      ["open", "launches another tool and owns its stdio"],
      // Local machine setup: mints a key and installs an OS login agent;
      // progress prose, no structured result document.
      ["copilot-app connect", "interactive install flow: writes an OS login agent"],
      // Agent-only signal: prints the resource id for the relay to intercept;
      // it has no -o json data mode because it returns no platform result.
      ["navigate open", "signal command: prints the resource id, no data payload"],
      ["docs", "prints fetched markdown verbatim"],
      ["scenario-docs", "prints fetched markdown verbatim"],

      // Interactive / credential flows: prompts, not documents.
      ["login", "interactive credential flow"],
      ["logout", "interactive credential flow"],
      // The output contract covers commands that return a platform document.
      // This one reports what it wrote to the local machine, so there is no
      // document for `--json` to carry.
      ["instrument", "local setup flow: writes telemetry wiring files"],
      ["help", "renders help text"],

      // Own their key/value or `--json` output, predating the contract.
      ...(["config get", "config list", "config set"] as const).map(
        (n) => [n, "prints resolved config values"] as const,
      ),
      ...(["daemon start", "daemon status", "daemon stop"] as const).map(
        (n) => [n, "owns its --json"] as const,
      ),
      ...(
        ["ingest codex", "ingest health", "ingest install", "ingest list", "ingest tail"] as const
      ).map((n) => [n, "owns its --json"] as const),
      ["governance status", "owns its --json"],
      ...(
        [
          "governance ingestion-templates admin-list",
          "governance ingestion-templates archive",
          "governance ingestion-templates clone-from-platform",
          "governance ingestion-templates create",
          "governance ingestion-templates get",
          "governance ingestion-templates update-ottl-rules",
        ] as const
      ).map((n) => [n, "owns its --json"] as const),

      // Local file sync: the effect is on disk, not a payload.
      ...(
        [
          "prompt add",
          "prompt init",
          "prompt pull",
          "prompt push",
          "prompt remove",
          "prompt sync",
        ] as const
      ).map((n) => [n, "syncs local prompt files"] as const),
    ]);

    const leafPaths = (root: Command): string[] => {
      const out: string[] = [];
      const walk = (command: Command, path: string[]): void => {
        const here = [...path, command.name()];
        if (command.commands.length === 0) {
          out.push(here.join(" "));
          return;
        }
        for (const child of command.commands) walk(child, here);
      };
      for (const child of root.commands) walk(child, []);
      return out;
    };

    it("either speaks the output contract or is a declared holdout", async () => {
      const { buildProgram } = await import("../../program.js");
      const root = buildProgram();

      const unaccounted = leafPaths(root).filter(
        (path) => !holdouts.has(path) && !isOutputAware(findCommand(root, path.split(" "))!),
      );

      expect(
        unaccounted,
        `These commands refuse \`-o json\` at exit 1 but are not declared holdouts. ` +
          `Wire them with emitsResult/rendersOwnResult, or add them to \`holdouts\` with a reason.`,
      ).toEqual([]);
    });

    // A holdout that has since been wired, or renamed away, is stale — and a
    // stale entry silently re-opens the hole this list exists to close.
    it("declares no holdout that is stale", async () => {
      const { buildProgram } = await import("../../program.js");
      const root = buildProgram();
      const leaves = new Set(leafPaths(root));

      const stale = [...holdouts.keys()].filter((path) => {
        if (!leaves.has(path)) return true;
        return isOutputAware(findCommand(root, path.split(" "))!);
      });

      expect(stale, "holdouts that no longer exist or are now wired").toEqual([]);
    });
  });
});
