/**
 * The machine-readable command catalog — one builder behind
 * `langwatch commands`, `langwatch help-tree`, and the `status` cheat-sheet.
 *
 * The command tree itself comes from commander (`buildProgram()` is the
 * ground truth for what exists); the metadata layered on top — usage hints
 * and skill annotations — comes from the canonical `feature-map.json`,
 * embedded at codegen time as `internal/generated/cli/feature-map.generated.ts`
 * (same copy-types.sh precedent as llmModels.json). No hand-maintained
 * parallel registry: a command added to program.ts shows up here
 * automatically, and the drift test in `cli/__tests__/` fails if the feature
 * map doesn't claim it.
 *
 * Token cost follows gcx: an estimate of what injecting this command's help
 * into an agent's context costs — chars of its rendered help / 4, rounded up.
 */
import type { Command } from "commander";
import {
  FEATURE_MAP,
  type GeneratedFeature,
} from "../../internal/generated/cli/feature-map.generated";

/** One flag on a command: the full flag spelling plus its help text. */
export interface CatalogFlag {
  name: string;
  description: string;
}

/** One positional argument. */
export interface CatalogArg {
  name: string;
  required: boolean;
}

/** One node of the catalog — a command group or a leaf command. */
export interface CatalogEntry {
  /** Full command path, e.g. `trace search` or `dataset records add`. */
  path: string;
  description: string;
  args: CatalogArg[];
  flags: CatalogFlag[];
  /** Usage example from the feature map, when one exists. */
  hint?: string;
  /** Skill that covers this command (own or nearest descendant's), if any. */
  skill?: string;
  /** Estimated tokens to inject this command's help (chars / 4, rounded up). */
  tokenCost: number;
  children: CatalogEntry[];
}

/**
 * Top-level commands that are CLI plumbing rather than product resources:
 * auth, config, browser openers, docs fetchers, the daemon, the gateway
 * pass-through wrappers, and the catalog commands themselves (self-referential).
 * Shared by the status cheat-sheet (which lists only resources) and the
 * feature-map drift test (which requires feature-map coverage for everything
 * NOT in this set). Keep it in sync with the exclusion list in the app-side
 * capabilityCatalog coverage test.
 */
export const PLUMBING_COMMANDS: ReadonlySet<string> = new Set([
  // Auth/session plumbing.
  "login",
  "logout",
  "whoami",
  // User-global CLI configuration, not platform data.
  "config",
  // Browser openers / local shell helpers.
  "open",
  "init-shell",
  "request-increase",
  // Local status + documentation fetchers.
  "status",
  "docs",
  "scenario-docs",
  // Gateway tool wrappers: exec another AI tool rather than returning a
  // LangWatch result.
  "claude",
  "codex",
  "cursor",
  "gemini",
  "opencode",
  // The CLI's own background process management.
  "daemon",
  // Local agent-skill installer: manages files under ~/.agents, not platform
  // data. Excluded app-side too (capabilityCatalog.coverage.unit.test.ts).
  "skills",
  // The catalog itself — self-referential.
  "commands",
  "help-tree",
  // Help topics — renders other commands' help or a static topic page.
  "help",
]);

interface FeatureMeta {
  hint?: string;
  skill?: string;
}

const flattenFeatures = (features: GeneratedFeature[]): GeneratedFeature[] =>
  features.flatMap((feature) => [
    feature,
    ...flattenFeatures(feature.children ?? []),
  ]);

/** Command string (`trace search`) -> metadata declared by the feature map. */
const featureMetaIndex = (): Map<string, FeatureMeta> => {
  const index = new Map<string, FeatureMeta>();
  for (const feature of flattenFeatures(FEATURE_MAP.features)) {
    const code = feature.surfaces?.code;
    const commands = code?.cli ?? [];
    for (const command of commands) {
      if (index.has(command)) continue; // first feature to claim a command wins
      const hint = code?.hints?.[command] ?? undefined;
      const skill = code?.skill ?? undefined;
      index.set(command, {
        ...(hint !== undefined ? { hint } : {}),
        ...(skill !== undefined ? { skill } : {}),
      });
    }
  }
  return index;
};

/** Commander private API, re-checked on upgrades (same precedent as output.ts). */
const isHidden = (command: Command): boolean =>
  (command as unknown as { _hidden?: boolean })._hidden === true;

const usageArgs = (args: CatalogArg[]): string =>
  args.map((arg) => (arg.required ? `<${arg.name}>` : `[${arg.name}]`)).join(" ");

/**
 * The synthetic rendered help a token cost is estimated from — the usage line
 * plus one line per flag, roughly what `langwatch <path> --help` shows.
 */
const renderedHelp = (entry: Omit<CatalogEntry, "tokenCost">): string => {
  const usage = ["langwatch", entry.path, usageArgs(entry.args)]
    .filter((part) => part.length > 0)
    .join(" ");
  const flagLines = entry.flags.map(
    (flag) => `\n  ${flag.name}  ${flag.description}`,
  );
  return `${usage} — ${entry.description}${flagLines.join("")}`;
};

const toEntry = (
  command: Command,
  path: string,
  meta: Map<string, FeatureMeta>,
): CatalogEntry => {
  const children = command.commands
    .filter((child) => !isHidden(child))
    .map((child) => toEntry(child, `${path} ${child.name()}`, meta));

  const declared = meta.get(path);
  // A group inherits the nearest descendant's skill so the help-tree can
  // annotate `trace  # skill: tracing` even though hints/skills are declared
  // per leaf command in the map.
  const skill =
    declared?.skill ?? children.map((child) => child.skill).find((s) => s !== undefined);

  const withoutCost: Omit<CatalogEntry, "tokenCost"> = {
    path,
    description: command.description(),
    args: command.registeredArguments.map((arg) => ({
      name: arg.name(),
      required: arg.required,
    })),
    // The global output flags are hideHelp()'d on every subcommand, so this
    // filter keeps them out of per-command flag lists while command-owned
    // non-hidden `--json` payloads (dataset records add/update) stay in.
    flags: command.options
      .filter((option) => !option.hidden)
      .map((option) => ({
        name: option.flags,
        description: option.description ?? "",
      })),
    ...(declared?.hint !== undefined ? { hint: declared.hint } : {}),
    ...(skill !== undefined ? { skill } : {}),
    children,
  };

  return { ...withoutCost, tokenCost: Math.ceil(renderedHelp(withoutCost).length / 4) };
};

/**
 * Build the catalog from the live commander tree. Hidden commands (the
 * gateway wrappers, `ingest install`) are excluded, matching what
 * `langwatch --help` shows.
 */
export const buildCatalog = (program: Command): CatalogEntry[] => {
  const meta = featureMetaIndex();
  return program.commands
    .filter((command) => !isHidden(command))
    .map((command) => toEntry(command, command.name(), meta));
};

/** Depth-first flattening of the catalog, groups included, in tree order. */
export const flattenCatalog = (entries: CatalogEntry[]): CatalogEntry[] =>
  entries.flatMap((entry) => [entry, ...flattenCatalog(entry.children)]);

const annotate = (entry: CatalogEntry): string => {
  const annotations: string[] = [];
  if (entry.hint !== undefined) annotations.push(`# hint: ${entry.hint}`);
  if (entry.skill !== undefined) annotations.push(`# skill: ${entry.skill}`);
  return annotations.length > 0 ? `  ${annotations.join("  ")}` : "";
};

/**
 * The compact indented tree for agent context injection (gcx `help-tree`
 * clone): one line per command, `# hint:` / `# skill:` annotations where the
 * feature map declares them.
 */
export const renderHelpTree = (entries: CatalogEntry[]): string => {
  const lines: string[] = ["langwatch"];
  const visit = (entry: CatalogEntry, depth: number): void => {
    const indent = "  ".repeat(depth);
    const args = usageArgs(entry.args);
    const name = entry.path.split(" ").pop() ?? entry.path;
    const usage = args.length > 0 ? `${name} ${args}` : name;
    lines.push(`${indent}${usage} — ${entry.description}${annotate(entry)}`);
    entry.children.forEach((child) => visit(child, depth + 1));
  };
  entries.forEach((entry) => visit(entry, 1));
  return lines.join("\n");
};

/**
 * The status cheat-sheet: top-level resource groups with their one-line
 * descriptions, plumbing excluded — the generated replacement for the
 * hardcoded command list `status` used to print.
 */
export const renderStatusSummary = (entries: CatalogEntry[]): string[] => {
  const groups = entries.filter((entry) => !PLUMBING_COMMANDS.has(entry.path));
  const width = Math.max(...groups.map((entry) => entry.path.length));
  return groups.map(
    (entry) => `langwatch ${entry.path.padEnd(width)}  ${entry.description}`,
  );
};
