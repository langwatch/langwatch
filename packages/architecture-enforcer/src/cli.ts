#!/usr/bin/env tsx
import { relative, resolve } from "node:path";
import {
  boundaryEdgesFromViolations,
  buildWorkspaceSnapshot,
  changedSourceFiles,
  declaredWebDependencyPairs,
  enabledPolicies,
  excludedPolicyIds,
  filterBaselinedBoundaryEdges,
  lintBoundaryEdgeBaseline,
  lintComposedExportsBaseline,
  lintFeatureLayouts,
  lintManifests,
  lintPolicies,
  lintServiceCeilings,
  lintStrictPortModules,
  lintTestQuality,
  POLICIES,
  type ArchitectureViolation,
  type PolicyDefinition,
  type WorkspaceSnapshot,
} from "./index.ts";
import { buildReport, formatReport } from "./report.ts";

const USAGE = `architecture-enforcer [options]

  --root <path>                    workspace root (default: the current directory)
  --all                            print every finding, not the first 25 per policy
  --list-policies                  print the policy registry (id, spec, baseline) and exit
  --review-test-quality            run the test-quality policy alone
  --shrinking-baseline-only        compare the debt inventories with the merge base
  --baseline-reference-dir <path>  directory holding the merge-base baseline copies
  --no-declarations                skip the declaration policies
  --no-legacy-application-migration
  --no-legacy-feature-fragments
  --no-composed-exports
  --help

Exit codes: 0 clean, 1 findings or stale baseline rows, 2 bad arguments or a crash.
`;

const VALUE_FLAGS = new Set([
  "--root",
  "--baseline-reference-dir",
  "--boundary-edge-baseline-reference",
  "--composed-exports-baseline-reference",
]);

const BOOLEAN_FLAGS = new Set([
  "--all",
  "--list-policies",
  "--review-test-quality",
  "--shrinking-baseline-only",
  "--no-declarations",
  "--no-legacy-application-migration",
  "--no-legacy-feature-fragments",
  "--no-composed-exports",
  "--help",
  "-h",
]);

type CliOptions = {
  root: string;
  mode: "check" | "shrink" | "review";
  baselineDir?: string;
  all: boolean;
  reviewTestQuality: boolean;
  declarations: boolean;
  legacyApplicationMigration: boolean;
  legacyFeatureFragments: boolean;
  composedExports: boolean;
  references: Map<string, string>;
};

type ParseResult =
  | { kind: "run"; options: CliOptions }
  | { kind: "help" }
  | { kind: "list-policies" }
  | { kind: "usage-error"; message: string };

type Arguments = { values: Map<string, string>; flags: Set<string> };

function collectArguments(argv: readonly string[]): Arguments | string {
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index] ?? "";
    // pnpm forwards the `--` separating its own flags from the script's.
    const known = argument === "--" || BOOLEAN_FLAGS.has(argument);

    if (known) {
      flags.add(argument);
      continue;
    }

    if (!VALUE_FLAGS.has(argument)) return `unknown argument ${argument}`;

    const value = argv[index + 1];

    if (value === void 0 || value.startsWith("-")) return `${argument} needs a path after it`;

    values.set(argument, value);
    index++;
  }

  return { values, flags };
}

function modeOf(flags: Set<string>): CliOptions["mode"] {
  if (flags.has("--review-test-quality")) return "review";

  return flags.has("--shrinking-baseline-only") ? "shrink" : "check";
}

export function parseArgv(argv: readonly string[]): ParseResult {
  const collected = collectArguments(argv);

  if (typeof collected === "string") return { kind: "usage-error", message: collected };

  const { values, flags } = collected;
  const wantsHelp = flags.has("--help") || flags.has("-h");

  if (wantsHelp) return { kind: "help" };

  if (flags.has("--list-policies")) return { kind: "list-policies" };

  return {
    kind: "run",
    options: {
      root: resolve(values.get("--root") ?? process.cwd()),
      mode: modeOf(flags),
      baselineDir: values.get("--baseline-reference-dir"),
      all: flags.has("--all"),
      reviewTestQuality: flags.has("--review-test-quality"),
      declarations: !flags.has("--no-declarations"),
      legacyApplicationMigration: !flags.has("--no-legacy-application-migration"),
      legacyFeatureFragments: !flags.has("--no-legacy-feature-fragments"),
      composedExports: !flags.has("--no-composed-exports"),
      references: values,
    },
  };
}

/** An explicit `--<name>-reference` wins; otherwise the merge-base directory names the file. */
function reference(options: CliOptions, flag: string, file: string): string | undefined {
  const fromDirectory = options.baselineDir ? `${options.baselineDir}/${file}` : void 0;

  return options.references.get(flag) ?? fromDirectory;
}

function boundaryEdgeReference(options: CliOptions): string | undefined {
  return reference(options, "--boundary-edge-baseline-reference", "boundary-edge-baseline.json");
}

type ShrinkResult = { findings: ArchitectureViolation[]; bootstrapped: string[] };

function shrinkFindings(options: CliOptions, snapshot: WorkspaceSnapshot): ShrinkResult {
  const { root } = options;

  // `lintManifests`/`lintFeatureLayouts` run outside `lintWorkspace` here, so
  // their violations still carry absolute file paths — relativize before
  // deriving edges, which are keyed by the workspace-relative `from`.
  const inventory = [
    ...lintManifests(snapshot, declaredWebDependencyPairs(snapshot)),
    ...lintFeatureLayouts(snapshot),
  ];

  const edges = boundaryEdgesFromViolations(
    inventory.map((violation) => ({ ...violation, file: relative(root, violation.file) })),
  );

  const boundaryEdges = lintBoundaryEdgeBaseline(root, edges, boundaryEdgeReference(options));

  const composedExports = lintComposedExportsBaseline(
    root,
    reference(options, "--composed-exports-baseline-reference", "composed-exports-baseline.json"),
  );

  const bootstrapped = boundaryEdges.bootstrapped ? ["boundary edge"] : [];

  const findings = [
    ...boundaryEdges.violations,
    ...composedExports.violations,
    ...lintServiceCeilings(snapshot),
    ...lintStrictPortModules(snapshot),
  ];

  return { findings, bootstrapped };
}

/**
 * `--no-declarations` and `--no-legacy-feature-fragments` share
 * `enabledPolicies` with `lintWorkspace`, so the CLI never runs a policy it
 * was asked to skip; `--no-composed-exports` is CLI-only, the same way.
 */
function cliEnabledPolicies(options: CliOptions): readonly PolicyDefinition[] {
  const policies = enabledPolicies(options);

  return options.composedExports ? policies : policies.filter((policy) => policy.id !== "composed-exports");
}

function checkFindings(
  options: CliOptions,
  snapshot: WorkspaceSnapshot,
): ArchitectureViolation[] {
  const { root } = options;
  const excluded = excludedPolicyIds(options);

  const workspace = lintPolicies(snapshot, cliEnabledPolicies(options)).filter(
    (violation) => !excluded.has(violation.policy),
  );

  // `lintWorkspace` already relativized `file`, so its cross-feature and
  // private-runtime-export violations are the current edges as-is.
  const boundaryEdges = lintBoundaryEdgeBaseline(
    root,
    boundaryEdgesFromViolations(workspace),
    boundaryEdgeReference(options),
  );

  return [...filterBaselinedBoundaryEdges(workspace, boundaryEdges.entries), ...boundaryEdges.violations];
}

function testQualityFindings(
  options: CliOptions,
  snapshot: WorkspaceSnapshot,
): ArchitectureViolation[] {
  return lintTestQuality(snapshot, { files: snapshot.changedFiles }).map((violation) => ({
    ...violation,
    file: relative(options.root, violation.file) || violation.file,
  }));
}

function printClean(options: CliOptions, bootstrapped: readonly string[]): void {
  for (const name of bootstrapped) {
    process.stdout.write(
      `architecture-enforcer: accepting the one-time ${name} baseline bootstrap; future merge-base checks can only shrink it\n`,
    );
  }

  const verdict = options.reviewTestQuality
    ? "architecture-enforcer: test-quality review complete"
    : "architecture-enforcer: package boundaries are sealed";

  process.stdout.write(`${verdict}\n`);
}

function run(options: CliOptions): 0 | 1 {
  const changedFiles = changedSourceFiles(options.root);
  const snapshot = buildWorkspaceSnapshot({ root: options.root, changedFiles });
  const shrink = options.mode === "shrink" ? shrinkFindings(options, snapshot) : void 0;

  const findings = options.reviewTestQuality
    ? testQualityFindings(options, snapshot)
    : (shrink?.findings ?? checkFindings(options, snapshot));

  const report = buildReport(findings);

  if (report.exitCode === 0) {
    printClean(options, shrink?.bootstrapped ?? []);

    return 0;
  }

  process.stderr.write(formatReport(report, { all: options.all }));

  return 1;
}

function describeCrash(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;

  return String(error);
}

/** Format each registered policy: id, spec, and baseline file (if present). */
function formatPolicyList(): string {
  const rows = POLICIES.map(
    (policy) => `${policy.id}\n  spec: ${policy.spec}\n  baseline: ${policy.baseline ?? "none"}`,
  );

  return `architecture-enforcer: ${POLICIES.length} registered polic${POLICIES.length === 1 ? "y" : "ies"}\n\n${rows.join("\n")}\n`;
}

const parsed = parseArgv(process.argv.slice(2));

if (parsed.kind === "help") {
  process.stdout.write(USAGE);
} else if (parsed.kind === "list-policies") {
  process.stdout.write(formatPolicyList());
} else if (parsed.kind === "usage-error") {
  process.stderr.write(`architecture-enforcer: ${parsed.message}\n\n${USAGE}`);
  process.exitCode = 2;
} else {
  try {
    process.exitCode = run(parsed.options);
  } catch (error) {
    process.stderr.write(`architecture-enforcer: the run crashed\n  ${describeCrash(error)}\n`);
    process.exitCode = 2;
  }
}
