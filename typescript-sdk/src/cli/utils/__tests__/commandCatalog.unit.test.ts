/**
 * The command catalog builder: the one structure behind `langwatch commands`,
 * `langwatch help-tree`, and the `status` cheat-sheet. The tree comes from
 * the live commander program, the hints/skills from the embedded feature map
 * — these tests pin both directions of that join so the catalog can never
 * silently drift from what the CLI registers or the map declares.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildProgram } from "../../program";
import {
  buildCatalog,
  flattenCatalog,
  PLUMBING_COMMANDS,
  renderHelpTree,
  renderStatusSummary,
  type CatalogEntry,
} from "../commandCatalog";
import { FEATURE_MAP } from "../../../internal/generated/cli/feature-map.generated";
import { AGENT_MODE_ENV_VARS } from "../output";

// program.ts reads the tsup-injected __CLI_VERSION__ build constant; under
// vitest there is no bundler define, so stub it before buildProgram() runs.
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

interface RawFeature {
  children?: RawFeature[];
  surfaces?: { code?: { cli?: string[] | null } | null } | null;
}

const featureMapCliCommands = (): string[] => {
  const flatten = (features: RawFeature[]): RawFeature[] =>
    features.flatMap((feature) => [feature, ...flatten(feature.children ?? [])]);
  return flatten(FEATURE_MAP.features as RawFeature[]).flatMap(
    (feature) => feature.surfaces?.code?.cli ?? [],
  );
};

describe("buildCatalog", () => {
  let catalog: CatalogEntry[];
  let flat: CatalogEntry[];
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Agent-mode env vars would leak the caller's environment into format
    // resolution; the catalog itself is env-independent but keep tests hermetic.
    for (const name of AGENT_MODE_ENV_VARS) {
      savedEnv[name] = process.env[name];
      delete process.env[name];
    }
    catalog = buildCatalog(buildProgram());
    flat = flattenCatalog(catalog);
  });

  afterEach(() => {
    for (const name of AGENT_MODE_ENV_VARS) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
  });

  it("covers every registered non-hidden top-level command", () => {
    const registered = buildProgram()
      .commands.filter(
        (command) =>
          (command as unknown as { _hidden?: boolean })._hidden !== true,
      )
      .map((command) => command.name());
    const cataloged = catalog.map((entry) => entry.path);
    expect(cataloged.sort()).toEqual(registered.sort());
  });

  it("excludes the hidden gateway wrappers and hidden primitives", () => {
    const paths = flat.map((entry) => entry.path);
    for (const hidden of ["claude", "codex", "cursor", "gemini", "ingest install"]) {
      expect(paths).not.toContain(hidden);
    }
  });

  it("contains every CLI command the feature map declares (catalog completeness)", () => {
    const paths = new Set(flat.map((entry) => entry.path));
    const missing = featureMapCliCommands().filter((command) => !paths.has(command));
    expect(
      missing,
      `Feature-map CLI commands missing from the live catalog — fix program.ts or feature-map.json:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("declares feature-map coverage for every resource leaf it lists", () => {
    const declared = new Set(featureMapCliCommands());
    const uncovered = flat.filter(
      (entry) =>
        entry.children.length === 0 &&
        entry.path.includes(" ") &&
        !PLUMBING_COMMANDS.has(entry.path.split(" ")[0]!) &&
        !declared.has(entry.path),
    );
    expect(
      uncovered.map((entry) => entry.path),
      "Catalog leaf commands with no feature-map entry — add them to surfaces.code.cli:",
    ).toEqual([]);
  });

  it("attaches hints and skills from the feature map", () => {
    const traceSearch = flat.find((entry) => entry.path === "trace search");
    expect(traceSearch?.hint).toContain("langwatch trace search");
    expect(traceSearch?.skill).toBe("tracing");

    const analyticsQuery = flat.find((entry) => entry.path === "analytics query");
    expect(analyticsQuery?.skill).toBe("analytics");
  });

  it("inherits a group's skill from its leaves", () => {
    const trace = catalog.find((entry) => entry.path === "trace");
    expect(trace?.skill).toBe("tracing");
  });

  it("extracts args and command-owned flags, but not the hidden global output flags", () => {
    const traceGet = flat.find((entry) => entry.path === "trace get");
    expect(traceGet?.args).toEqual([{ name: "traceId", required: true }]);

    const traceSearch = flat.find((entry) => entry.path === "trace search");
    const flagNames = traceSearch?.flags.map((flag) => flag.name) ?? [];
    expect(flagNames).toContain("-q, --query <query>");
    expect(flagNames).toContain("-f, --format <format>");
    // Global output flags are hideHelp()'d on subcommands — they belong to
    // the contract, not to each command's own flag list.
    expect(flagNames.some((name) => name.includes("--jq"))).toBe(false);
    expect(flagNames.some((name) => name.includes("--agent"))).toBe(false);
  });

  it("estimates token cost from rendered help length (chars / 4, rounded up)", () => {
    for (const entry of flat) {
      expect(entry.tokenCost).toBeGreaterThan(0);
      expect(entry.tokenCost).toBeLessThan(1000);
    }
    // Exact formula check on one entry: rebuild the synthetic help by hand.
    const traceGet = flat.find((entry) => entry.path === "trace get")!;
    const usage = `langwatch trace get <traceId> — ${traceGet.description}`;
    const flags = traceGet.flags
      .map((flag) => `\n  ${flag.name}  ${flag.description}`)
      .join("");
    expect(traceGet.tokenCost).toBe(Math.ceil((usage + flags).length / 4));
  });
});

describe("renderHelpTree", () => {
  const tree = (): string => {
    (globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";
    return renderHelpTree(buildCatalog(buildProgram()));
  };

  it("renders an indented tree rooted at the binary name", () => {
    const lines = tree().split("\n");
    expect(lines[0]).toBe("langwatch");
    // Groups indent two spaces, leaves four.
    expect(lines.some((line) => line.startsWith("  trace — "))).toBe(true);
    expect(lines.some((line) => line.startsWith("    search — "))).toBe(true);
    // Nested groups go deeper still.
    expect(lines.some((line) => line.startsWith("      list — "))).toBe(true);
  });

  it("annotates hints and skills where the feature map declares them", () => {
    const output = tree();
    expect(output).toContain("# hint: langwatch trace search");
    expect(output).toContain("# skill: tracing");
    expect(output).toContain("# skill: prompts");
  });

  it("includes positional args in the usage", () => {
    expect(tree()).toContain("get <traceId> — ");
  });
});

describe("renderStatusSummary", () => {
  const summary = (): string[] => {
    (globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";
    return renderStatusSummary(buildCatalog(buildProgram()));
  };

  it("lists resource groups with their descriptions", () => {
    const lines = summary();
    expect(lines.some((line) => line.startsWith("langwatch trace"))).toBe(true);
    expect(lines.some((line) => line.includes("Search and inspect traces"))).toBe(true);
    expect(lines.some((line) => line.startsWith("langwatch virtual-keys"))).toBe(true);
  });

  it("excludes CLI plumbing", () => {
    const lines = summary();
    for (const plumbing of PLUMBING_COMMANDS) {
      expect(lines.some((line) => line.startsWith(`langwatch ${plumbing} `))).toBe(false);
      expect(lines.some((line) => line === `langwatch ${plumbing}`)).toBe(false);
    }
  });

  it("aligns the description column", () => {
    const lines = summary();
    const starts = lines.map((line) => line.indexOf("  ") + 2);
    // Every description begins at the same column: path padded to the widest group.
    const descColumns = lines.map((line) => {
      const match = /^langwatch \S+\s+(?=\S)/.exec(line);
      return match ? match[0].length : -1;
    });
    expect(new Set(descColumns).size).toBe(1);
    expect(starts.length).toBeGreaterThan(10);
  });
});
