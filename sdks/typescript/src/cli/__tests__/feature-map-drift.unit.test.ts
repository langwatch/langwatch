/**
 * Drift guard between the CLI's real command surface and `feature-map.json`.
 *
 * The CLI's `program.ts` is the ground truth for which command groups exist;
 * the feature map (embedded at codegen time as
 * `internal/generated/cli/feature-map.generated.ts`) is the canonical
 * information architecture every surface derives from. This test fails — with
 * a readable list, not a count — when a top-level CLI group has no feature-map
 * CLI coverage, or the map lists a group the CLI no longer registers.
 *
 * It lives in typescript-sdk (not next to the app-side capabilityCatalog
 * coverage test it mirrors) because this is where the dependencies to parse
 * and run exist; the parsing approach is the same regex over program.ts.
 *
 * @see .claude/skills/feature-map/SKILL.md
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  FEATURE_MAP,
  type GeneratedFeature,
} from "../../internal/generated/cli/feature-map.generated";
import { PLUMBING_COMMANDS } from "../utils/commandCatalog";

const CLI_PROGRAM_PATH = join(__dirname, "../program.ts");

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

const flattenFeatures = (features: GeneratedFeature[]): GeneratedFeature[] =>
  features.flatMap((feature) => [
    feature,
    ...flattenFeatures(feature.children ?? []),
  ]);

/** The top-level group words of every CLI command the feature map claims. */
function featureMapCliGroups(): Set<string> {
  const groups = new Set<string>();
  for (const feature of flattenFeatures(FEATURE_MAP.features)) {
    for (const command of feature.surfaces?.code?.cli ?? []) {
      const [group] = command.trim().split(/\s+/);
      if (group) groups.add(group);
    }
  }
  return groups;
}

describe("the feature map, given the CLI's real command tree", () => {
  const cliCommands = cliTopLevelCommands();
  const cliGroups = [...cliCommands].filter(
    (command) => !PLUMBING_COMMANDS.has(command),
  );
  const mapGroups = featureMapCliGroups();

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
      const staleExclusions = [...PLUMBING_COMMANDS].filter(
        (command) => !cliCommands.has(command),
      );
      expect(
        staleExclusions,
        `Excluded commands the CLI no longer registers — remove them from PLUMBING_COMMANDS:\n  ${staleExclusions.join("\n  ")}`,
      ).toEqual([]);
    });
  });

  describe("when the map is compared against the CLI", () => {
    it("covers every non-excluded CLI group with feature-map CLI commands", () => {
      const missing = cliGroups.filter((group) => !mapGroups.has(group));
      expect(
        missing,
        [
          "CLI command groups with no feature-map CLI coverage.",
          "Add their commands to the owning feature's surfaces.code.cli in feature-map.json",
          "(or to PLUMBING_COMMANDS in cli/utils/commandCatalog.ts if it is CLI plumbing):",
          ...missing.map((group) => `  langwatch ${group} …`),
        ].join("\n"),
      ).toEqual([]);
    });

    it("lists no CLI group the CLI no longer registers", () => {
      const stale = [...mapGroups].filter((group) => !cliCommands.has(group));
      expect(
        stale,
        [
          "Feature-map CLI commands for groups the CLI no longer registers.",
          "Remove them from feature-map.json (or fix the CLI):",
          ...stale.map((group) => `  ${group}`),
        ].join("\n"),
      ).toEqual([]);
    });
  });
});
