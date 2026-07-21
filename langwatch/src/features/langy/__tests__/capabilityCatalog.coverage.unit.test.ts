/**
 * Drift guard between the CLI's real command surface and the capability
 * catalog. The CLI's `program.ts` is the ground truth for which resources
 * exist; the catalog is the panel's view binding for them. This test fails —
 * with a readable list, not a count — when either side has something the
 * other doesn't, so a new CLI resource cannot ship without a card and a dead
 * catalog row cannot linger.
 *
 * @see specs/langy/langy-capability-cards.feature
 */
import { DIGEST_STRATEGIES } from "@langwatch/cli-cards";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_CATALOG,
  CAPABILITY_SURFACES,
} from "../components/capabilities/capabilityCatalog";
import {
  SURFACE_LABEL,
  SURFACE_PATH,
} from "../components/capabilities/capabilityRegistry";

const CLI_PROGRAM_PATH = fileURLToPath(
  new URL(
    "../../../../../typescript-sdk/src/cli/program.ts",
    import.meta.url,
  ),
);

/**
 * Top-level commands that deliberately have NO catalog entry. Each is a CLI
 * utility a result card would be meaningless for — none of them read or write
 * a platform resource a user could open a surface on.
 *
 * Keep it in sync with PLUMBING_COMMANDS in the SDK's
 * `cli/utils/commandCatalog.ts` (the mirror of this list).
 */
const EXCLUDED_COMMANDS = new Set([
  // Auth/session plumbing: acts on the CLI's own credentials, not on a
  // platform resource.
  "login",
  "logout",
  "whoami",
  // User-global CLI configuration (~/.langwatch/config.json), not platform data.
  "config",
  // Opens a browser / prints local status — no result document to card.
  "open",
  "status",
  "init-shell",
  "request-increase",
  // Documentation fetchers: their output is prose for the agent, and the
  // docs helpers already render as clean activity lines.
  "docs",
  "scenario-docs",
  // Local agent-skill installer (~/.agents/skills): manages files on the
  // machine the CLI runs on, not a platform resource a card could deep-link.
  "skills",
  // Gateway tool wrappers: they exec another AI tool (claude/codex/cursor/
  // gemini/opencode) rather than returning a LangWatch result.
  "claude",
  "codex",
  "cursor",
  "gemini",
  "opencode",
  // The CLI's own background process management — pure local plumbing.
  "daemon",
  // The catalog itself — self-referential: a card for the command that lists
  // commands would describe the CLI's own meta surface, not a platform
  // resource.
  "commands",
  "help-tree",
  // Help topics: renders other commands' help or a static topic page — no
  // platform resource a card could deep-link.
  "help",
]);

/**
 * The top-level resource words the CLI registers: every
 * `program.command("<word> …")`, whether registered inline or via
 * `const xCmd = program\n  .command(…)`. Sub-commands are registered on the
 * sub-command objects and deliberately not matched.
 */
function cliTopLevelCommands(): Set<string> {
  const source = readFileSync(CLI_PROGRAM_PATH, "utf-8");
  const pattern = /(?:const\s+\w+\s*=\s*)?\bprogram\s*(?:[\r\n]+\s*)?\.command\(\s*"([^"\s]+)/g;
  const commands = new Set<string>();
  for (const match of source.matchAll(pattern)) {
    commands.add(match[1]!);
  }
  return commands;
}

describe("the capability catalog, given the CLI's real command tree", () => {
  const cliCommands = cliTopLevelCommands();
  const cliResources = [...cliCommands].filter(
    (command) => !EXCLUDED_COMMANDS.has(command),
  );
  const catalogResources = Object.keys(CAPABILITY_CATALOG);

  describe("when the CLI source is parsed", () => {
    it("finds the command tree (canary against parser rot)", () => {
      // If the CLI restructures how commands are registered, this fails first
      // and loudly — a silent empty parse would make the drift checks pass
      // while checking nothing.
      expect(cliCommands.size).toBeGreaterThanOrEqual(20);
      expect(cliCommands.has("trace")).toBe(true);
      expect(cliCommands.has("dataset")).toBe(true);
    });

    it("excludes only commands the CLI actually has", () => {
      const staleExclusions = [...EXCLUDED_COMMANDS].filter(
        (command) => !cliCommands.has(command),
      );
      expect(
        staleExclusions,
        `Excluded commands the CLI no longer registers — remove them from EXCLUDED_COMMANDS:\n  ${staleExclusions.join("\n  ")}`,
      ).toEqual([]);
    });
  });

  describe("when the catalog is compared against the CLI", () => {
    it("has a catalog entry for every CLI resource", () => {
      const missing = cliResources.filter(
        (resource) => !catalogResources.includes(resource),
      );
      expect(
        missing,
        [
          "CLI resources with no capability catalog entry.",
          "Add a row to CAPABILITY_CATALOG (surface, digestStrategy, noun, body) for each:",
          ...missing.map((resource) => `  langwatch ${resource} …`),
        ].join("\n"),
      ).toEqual([]);
    });

    it("has no catalog entry for a resource the CLI no longer ships", () => {
      const stale = catalogResources.filter(
        (resource) => !cliResources.includes(resource),
      );
      expect(
        stale,
        [
          "Catalog entries for resources the CLI no longer registers.",
          "Remove these rows from CAPABILITY_CATALOG (or fix the CLI):",
          ...stale.map((resource) => `  ${resource}`),
        ].join("\n"),
      ).toEqual([]);
    });
  });

  describe("when every catalog entry's digest strategy is checked", () => {
    it("declares one of the four strategies explicitly, per resource", () => {
      // The interface makes the field required at compile time; this pins it
      // at runtime too (a JS-side catalog edit, a bad cast) and fails with the
      // rows named rather than a type-error page.
      const strategies = new Set<string>(DIGEST_STRATEGIES);
      const undeclared = Object.entries(CAPABILITY_CATALOG).filter(
        ([, entry]) =>
          !strategies.has((entry as { digestStrategy?: string }).digestStrategy ?? ""),
      );
      expect(
        undeclared.map(([resource]) => resource),
        [
          "Catalog rows without a valid digestStrategy declaration.",
          `Declare one of: ${DIGEST_STRATEGIES.join(" | ")} on each row:`,
          ...undeclared.map(([resource]) => `  ${resource}`),
        ].join("\n"),
      ).toEqual([]);
    });
  });

  describe("when every catalog surface is checked against the view binding", () => {
    it("resolves each entry's surface to a label and a path", () => {
      const broken = Object.entries(CAPABILITY_CATALOG).filter(
        ([, entry]) =>
          !SURFACE_LABEL[entry.surface] || !SURFACE_PATH[entry.surface],
      );
      expect(
        broken.map(([resource, entry]) => `${resource} -> ${entry.surface}`),
        "Catalog entries pointing at a surface with no SURFACE_LABEL / SURFACE_PATH row.",
      ).toEqual([]);
    });

    it("declares every surface it uses in the surface vocabulary", () => {
      const surfaces = new Set(CAPABILITY_SURFACES);
      const unknown = Object.entries(CAPABILITY_CATALOG).filter(
        ([, entry]) => !surfaces.has(entry.surface),
      );
      expect(unknown).toEqual([]);
    });
  });
});
