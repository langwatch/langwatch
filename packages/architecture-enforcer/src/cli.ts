#!/usr/bin/env tsx
import { relative, resolve } from "node:path";

import {
  buildWorkspaceSnapshot,
  changedSourceFiles,
  enabledPolicies,
  lintPolicies,
  lintTestQuality,
  POLICIES,
  type ArchitectureViolation,
  type WorkspaceSnapshot,
} from "./index.ts";
import { buildReport, formatReport } from "./report.ts";

const USAGE = `architecture-enforcer [options]

  --root <path>            workspace root (default: the current directory)
  --all                    print every finding, not the first 25 per policy
  --list-policies          print the policy registry (id, spec) and exit
  --policies <id,id,...>   run only these registry ids
  --review-test-quality    run the test-quality review over changed test files alone
  --no-declarations        skip the declarations policy (it needs tsc -b to have run)
  --help

Exit codes: 0 clean, 1 findings, 2 bad arguments or a crash (a missing anchor file included).
`;

const VALUE_FLAGS = new Set(["--root", "--policies"]);

const BOOLEAN_FLAGS = new Set([
  "--all",
  "--list-policies",
  "--review-test-quality",
  "--no-declarations",
  "--help",
  "-h",
]);

type CliOptions = {
  root: string;
  all: boolean;
  reviewTestQuality: boolean;
  declarations: boolean;
  only?: readonly string[];
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

    if (value === void 0 || value.startsWith("-")) return `${argument} needs a value after it`;

    values.set(argument, value);
    index++;
  }

  return { values, flags };
}

/** The ids `--policies` names, or the first one the registry does not know. */
function selectedPolicies(value: string | undefined): readonly string[] | { unknown: string } {
  if (value === void 0) return [];

  const ids = value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");

  const known = new Set(POLICIES.map((policy) => policy.id));
  const unknown = ids.find((id) => !known.has(id));

  return unknown === void 0 ? ids : { unknown };
}

export function parseArgv(argv: readonly string[]): ParseResult {
  const collected = collectArguments(argv);

  if (typeof collected === "string") return { kind: "usage-error", message: collected };

  const { values, flags } = collected;

  if (flags.has("--help") || flags.has("-h")) return { kind: "help" };

  if (flags.has("--list-policies")) return { kind: "list-policies" };

  const selected = selectedPolicies(values.get("--policies"));

  if ("unknown" in selected) {
    return { kind: "usage-error", message: `--policies names unknown policy ${selected.unknown}` };
  }

  return {
    kind: "run",
    options: {
      root: resolve(values.get("--root") ?? process.cwd()),
      all: flags.has("--all"),
      reviewTestQuality: flags.has("--review-test-quality"),
      declarations: !flags.has("--no-declarations"),
      only: selected.length > 0 ? selected : void 0,
    },
  };
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

function run(options: CliOptions): 0 | 1 {
  const changedFiles = changedSourceFiles(options.root);
  const snapshot = buildWorkspaceSnapshot({ root: options.root, changedFiles });

  const findings = options.reviewTestQuality
    ? testQualityFindings(options, snapshot)
    : lintPolicies(snapshot, enabledPolicies(options));

  const report = buildReport(findings);

  if (report.exitCode === 0) {
    const verdict = options.reviewTestQuality
      ? "architecture-enforcer: test-quality review complete"
      : "architecture-enforcer: package boundaries are sealed";

    process.stdout.write(`${verdict}\n`);

    return 0;
  }

  process.stderr.write(formatReport(report, { all: options.all }));

  return 1;
}

function describeCrash(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;

  return String(error);
}

function formatPolicyList(): string {
  const rows = POLICIES.map((policy) => `${policy.id}\n  spec: ${policy.spec}`);

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
