/**
 * The port wired into the REAL command tree. The unit suites alongside this one
 * prove the mechanism; this proves it is actually connected — a migration that
 * converts an implementation but forgets its `emitsResult` registration would
 * leave the command silently unmigrated, which is precisely the state this work
 * exists to end.
 *
 * Split out of `output-port.unit.test.ts`, which pins the port itself.
 */
import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { isOutputAware } from "../output";

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
    // The commands that legitimately still print their own output because a
    // format-blind port cannot serve them: a raw byte stream, and the two
    // human-interactive `--wait` polls whose completion has no structured payload.
    const unmigrated = [
      ["dataset", "download"],
      ["suite", "run"],
      ["scenario", "run"],
    ];

    it.each(unmigrated)("leaves `%s %s` unmarked", async (group, name) => {
      const { buildProgram } = await import("../../program.js");
      const command = findCommand(buildProgram(), [group, name]);

      expect(command).toBeDefined();
      expect(isOutputAware(command!)).toBe(false);
    });
  });

  /**
   * The exhaustive counterpart to the per-command lists above: EVERY leaf in
   * the real tree is either wired to the port or named here as a deliberate
   * holdout.
   *
   * This is the check that was missing, and the per-command lists could not
   * have replaced it — the broken commands were simply absent from them.
   * `commands`, `help-tree`, `status`, `trace search|get` and the entire
   * `skills` group each rendered every format correctly through `printResult`,
   * but the gate only recognised `emitsResult`, so it refused `-o json` on all
   * of them with "does not emit structured output yet". `lw commands` — whose
   * own description is "Machine-readable catalog of every CLI command" — had no
   * working machine-readable path at all, and the refusal message pointed the
   * caller at it.
   *
   * Adding a command now forces a decision: wire it to the port, or say here
   * why it cannot be.
   */
  describe("every leaf command", () => {
    /** Leaf path -> why the port cannot serve it. */
    const holdouts = new Map<string, string>([
      // Raw byte stream / file destination: the payload is not a document.
      ["dataset download", "streams raw bytes to a file or stdout"],
      ["trace export", "writes its own jsonl/csv/json, to a file when asked"],

      // Human-interactive `--wait` polls: no structured completion payload.
      ["suite run", "human-interactive --wait poll"],
      ["scenario run", "human-interactive --wait poll"],

      // Launchers and passthroughs: they exec another tool and own its stdio.
      ...(
        ["claude", "codex", "cursor", "gemini", "opencode", "open"] as const
      ).map((n) => [n, "launches another tool and owns its stdio"] as const),
      // Agent-only signal: prints the resource id for the relay to intercept;
      // it has no -o json data mode because it returns no platform result.
      ["navigate open", "signal command: prints the resource id, no data payload"],
      ["docs", "prints fetched markdown verbatim"],
      ["scenario-docs", "prints fetched markdown verbatim"],
      ["init-shell", "emits shell script for eval"],

      // Interactive / credential flows: prompts, not documents.
      ["login", "interactive credential flow"],
      ["logout", "interactive credential flow"],
      ["whoami", "interactive credential flow"],
      ["request-increase", "interactive support flow"],
      ["help", "renders help text"],

      // Own their key/value or `--json` output, predating the contract.
      ...(["config get", "config list", "config set"] as const).map(
        (n) => [n, "prints resolved config values"] as const,
      ),
      ...(["daemon start", "daemon status", "daemon stop"] as const).map(
        (n) => [n, "owns its --json"] as const,
      ),
      ...(
        ["ingest health", "ingest install", "ingest list", "ingest tail"] as const
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
        (path) =>
          !holdouts.has(path) && !isOutputAware(findCommand(root, path.split(" "))!),
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
