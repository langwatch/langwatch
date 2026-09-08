#!/usr/bin/env tsx
import { relative, resolve } from "node:path";
import {
  boundaryEdgesFromViolations,
  buildWorkspaceSnapshot,
  changedSourceFiles,
  declaredWebDependencyPairs,
  filterBaselinedBoundaryEdges,
  lintBoundaryEdgeBaseline,
  lintCommentBlocks,
  lintCommentBlockRoots,
  lintComposedExports,
  lintComposedExportsBaseline,
  lintFeatureLayouts,
  lintManifests,
  lintOxlintBaseline,
  lintServiceCeilings,
  lintSnapshot,
  lintStrictPortModules,
  lintTestQuality,
  type ArchitectureViolation,
  type WorkspaceSnapshot,
} from "./index.ts";
import { buildReport, formatReport } from "./report.ts";

const USAGE = `architecture-lint [options]

  --root <path>                    workspace root (default: the current directory)
  --all                            print every finding, not the first 25 per policy
  --review-comment-blocks          print the comment-block review list; never fails
  --all-comment-blocks             review every file, not only the changed ones
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
  "--comment-block-roots-reference",
  "--boundary-edge-baseline-reference",
  "--oxlint-baseline-reference",
  "--composed-exports-baseline-reference",
]);

const BOOLEAN_FLAGS = new Set([
  "--all",
  "--review-comment-blocks",
  "--all-comment-blocks",
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
  reviewCommentBlocks: boolean;
  reviewTestQuality: boolean;
  allCommentBlocks: boolean;
  declarations: boolean;
  legacyApplicationMigration: boolean;
  legacyFeatureFragments: boolean;
  composedExports: boolean;
  references: Map<string, string>;
};

type ParseResult =
  | { kind: "run"; options: CliOptions }
  | { kind: "help" }
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
  const reviewing = flags.has("--review-comment-blocks") || flags.has("--review-test-quality");

  if (reviewing) return "review";

  return flags.has("--shrinking-baseline-only") ? "shrink" : "check";
}

export function parseArgv(argv: readonly string[]): ParseResult {
  const collected = collectArguments(argv);

  if (typeof collected === "string") return { kind: "usage-error", message: collected };

  const { values, flags } = collected;
  const wantsHelp = flags.has("--help") || flags.has("-h");

  if (wantsHelp) return { kind: "help" };

  return {
    kind: "run",
    options: {
      root: resolve(values.get("--root") ?? process.cwd()),
      mode: modeOf(flags),
      baselineDir: values.get("--baseline-reference-dir"),
      all: flags.has("--all"),
      reviewCommentBlocks: flags.has("--review-comment-blocks"),
      reviewTestQuality: flags.has("--review-test-quality"),
      allCommentBlocks: flags.has("--all-comment-blocks"),
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

function commentBlockRootsFindings(options: CliOptions): ArchitectureViolation[] {
  const check = lintCommentBlockRoots(
    options.root,
    reference(options, "--comment-block-roots-reference", "comment-block-roots.json"),
  );

  return check.violations;
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

  const oxlint = lintOxlintBaseline(
    root,
    reference(options, "--oxlint-baseline-reference", "oxlint-baseline.json"),
  );

  const composedExports = lintComposedExportsBaseline(
    root,
    reference(options, "--composed-exports-baseline-reference", "composed-exports-baseline.json"),
  );

  const bootstrapped = boundaryEdges.bootstrapped ? ["boundary edge"] : [];

  const findings = [
    ...boundaryEdges.violations,
    ...oxlint.violations,
    ...composedExports.violations,
    ...commentBlockRootsFindings(options),
    ...lintServiceCeilings(snapshot),
    ...lintStrictPortModules(snapshot),
  ];

  return { findings, bootstrapped };
}

function checkFindings(
  options: CliOptions,
  snapshot: WorkspaceSnapshot,
): ArchitectureViolation[] {
  const { root } = options;

  const workspace = lintSnapshot(snapshot, {
    declarations: options.declarations,
    legacyApplicationMigration: options.legacyApplicationMigration,
    legacyFeatureFragments: options.legacyFeatureFragments,
  });

  // `lintWorkspace` already relativized `file`, so its cross-feature and
  // private-runtime-export violations are the current edges as-is.
  const boundaryEdges = lintBoundaryEdgeBaseline(
    root,
    boundaryEdgesFromViolations(workspace),
    boundaryEdgeReference(options),
  );

  return [
    ...filterBaselinedBoundaryEdges(workspace, boundaryEdges.entries),
    ...commentBlockRootsFindings(options),
    ...boundaryEdges.violations,
    ...lintOxlintBaseline(root).violations,
    ...(options.composedExports ? lintComposedExports(snapshot) : []),
  ];
}

/** The review tier: blocks worth a second look. Printed only when asked for, never a refusal. */
function printCommentBlockReview(options: CliOptions, changedFiles: readonly string[]): void {
  const { reviews } = lintCommentBlocks(
    options.root,
    options.allCommentBlocks ? {} : { changedFiles },
  );

  if (reviews.length > 0) {
    const entries = reviews
      .map((review) => `[${review.category}] ${review.file}:${review.line}\n  ${review.message}`)
      .join("\n\n");

    process.stdout.write(
      `architecture-lint: comment-block review queue (${reviews.length} blocks, exit code unchanged)\n${entries}\n`,
    );
  }

  process.stdout.write("architecture-lint: comment-block review complete\n");
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
      `architecture-lint: accepting the one-time ${name} baseline bootstrap; future merge-base checks can only shrink it\n`,
    );
  }

  const verdict = options.reviewTestQuality
    ? "architecture-lint: test-quality review complete"
    : "architecture-lint: package boundaries are sealed";

  process.stdout.write(`${verdict}\n`);
}

function run(options: CliOptions): 0 | 1 {
  const changedFiles = changedSourceFiles(options.root);

  if (options.reviewCommentBlocks) {
    printCommentBlockReview(options, changedFiles);

    return 0;
  }

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

const parsed = parseArgv(process.argv.slice(2));

if (parsed.kind === "help") {
  process.stdout.write(USAGE);
} else if (parsed.kind === "usage-error") {
  process.stderr.write(`architecture-lint: ${parsed.message}\n\n${USAGE}`);
  process.exitCode = 2;
} else {
  try {
    process.exitCode = run(parsed.options);
  } catch (error) {
    process.stderr.write(`architecture-lint: the run crashed\n  ${describeCrash(error)}\n`);
    process.exitCode = 2;
  }
}
