import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, matchesGlob, relative } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation } from "../../types.ts";
import { sourceFile } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import { readWorkspaceMembers } from "../../workspace/workspace-members.ts";
import { startsContainers } from "./container-starters.ts";

const POLICY = "default-test-lane";
const TIMEOUT_CEILING_MS = 120_000;
const DEFAULT_CONFIGS = [
  "vitest.config.ts",
  "vitest.config.mts",
  "vitest.config.js",
  "vitest.config.mjs",
];
const VITEST_DEFAULT_INCLUDE = ["**/*.{test,spec}.?(c|m)[jt]s?(x)"];
const ALWAYS_EXCLUDED = ["**/node_modules/**", "**/dist/**"];
const SCENARIO_FILE = /\.scenario\.test\.[cm]?[jt]sx?$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".git", ".claude"]);
/** Packages the package-suites job does not run, one `<name>  # reason` per line. */
const SUITES_JOB_EXCLUDED = ".github/package-suites.excluded";

type Lane = {
  config: string | undefined;
  include: string[];
  exclude: string[];
  timeoutMs: number | undefined;
};

function scriptFlags(script: string, flag: string): string[] {
  const pattern = new RegExp(`${flag}[= ]+["']?([^"'\\s]+)["']?`, "g");
  return [...script.matchAll(pattern)].flatMap((match) => (match[1] ? [match[1]] : []));
}

function numericValue(node: ts.Expression): number | undefined {
  if (ts.isNumericLiteral(node)) return Number(node.text.replaceAll("_", ""));
  if (ts.isParenthesizedExpression(node)) return numericValue(node.expression);
  if (!ts.isBinaryExpression(node)) return undefined;
  const left = numericValue(node.left);
  const right = numericValue(node.right);
  if (left === undefined || right === undefined) return undefined;
  if (node.operatorToken.kind === ts.SyntaxKind.AsteriskToken) return left * right;
  if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) return left + right;
  return undefined;
}

function stringsOf(node: ts.Expression): string[] {
  if (!ts.isArrayLiteralExpression(node)) return [];
  return node.elements.flatMap((element) =>
    ts.isStringLiteralLike(element) ? [element.text] : [],
  );
}

/** The include, exclude and timeout a vitest config declares, read from its source. */
function readLane(file: string): Omit<Lane, "config"> {
  const source = sourceFile({ file });
  const lane: Omit<Lane, "config"> = { include: [], exclude: [], timeoutMs: undefined };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      const key = node.name.text;
      if (key === "include") lane.include.push(...stringsOf(node.initializer));
      if (key === "exclude") lane.exclude.push(...stringsOf(node.initializer));
      if (key === "testTimeout") lane.timeoutMs = numericValue(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lane;
}

function laneOf(directory: string, script: string): Lane {
  const named = scriptFlags(script, "--config")[0];
  const config = named
    ? join(directory, named)
    : DEFAULT_CONFIGS.map((name) => join(directory, name)).find(existsSync);
  const declared =
    config && existsSync(config)
      ? readLane(config)
      : { include: [], exclude: [], timeoutMs: undefined };
  return {
    config,
    include: declared.include.length > 0 ? declared.include : VITEST_DEFAULT_INCLUDE,
    exclude: [...ALWAYS_EXCLUDED, ...declared.exclude, ...scriptFlags(script, "--exclude")],
    timeoutMs: declared.timeoutMs,
  };
}

function testFiles(directory: string, base = directory): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return SKIPPED_DIRECTORIES.has(entry.name)
        ? []
        : testFiles(join(directory, entry.name), base);
    }
    return TEST_FILE.test(entry.name) ? [relative(base, join(directory, entry.name))] : [];
  });
}

function collects(lane: Lane, file: string): boolean {
  const included = lane.include.some((pattern) => matchesGlob(file, pattern));
  return included && !lane.exclude.some((pattern) => matchesGlob(file, pattern));
}

function testScriptOf(directory: string): string | undefined {
  const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const script = manifest.scripts?.test;
  return script?.includes("vitest") ? script : undefined;
}

/**
 * The packages the package-suites job leaves to their own jobs. Only that job runs
 * suites beside browser suites, so only its packages' lanes must not start containers.
 */
function excludedFromSuitesJob(root: string): Set<string> {
  const register = join(root, SUITES_JOB_EXCLUDED);
  if (!existsSync(register)) return new Set();
  const names = readFileSync(register, "utf8")
    .split("\n")
    .map((line) => line.split("#")[0]?.trim() ?? "");
  return new Set(names.filter((name) => name !== ""));
}

function violationsFor({
  directory,
  script,
  sharesShardWithBrowsers,
}: {
  directory: string;
  script: string;
  sharesShardWithBrowsers: boolean;
}): ArchitectureViolation[] {
  const lane = laneOf(directory, script);
  const file = lane.config ?? join(directory, "package.json");
  const slow =
    lane.timeoutMs !== undefined && lane.timeoutMs > TIMEOUT_CEILING_MS
      ? [
          {
            policy: POLICY,
            file,
            message: `The default test lane waits ${lane.timeoutMs} ms per test; a suite that needs longer than ${TIMEOUT_CEILING_MS} ms belongs in its own lane.`,
            allowed:
              "Move the slow suite to a vitest.<lane>.config file run by its own script, and keep `test` under two minutes per test.",
          },
        ]
      : [];
  const collected = testFiles(directory).filter((test) => collects(lane, test));
  const live = collected
    .filter((test) => SCENARIO_FILE.test(test))
    .map((scenario) => ({
      policy: POLICY,
      file: join(directory, scenario),
      message: `The default test lane collects ${scenario}, a scenario suite that drives live services.`,
      allowed:
        "Exclude `**/*.scenario.test.*` from the default lane and run scenarios through their own script and config.",
    }));
  const containers = collected
    .filter((test) => sharesShardWithBrowsers && !SCENARIO_FILE.test(test))
    .filter((test) => startsContainers(join(directory, test)))
    .map((test) => ({
      policy: POLICY,
      file: join(directory, test),
      message: `The default test lane collects ${test}, which starts a container. In CI that lane runs beside browser suites, and a container's network change aborts Chromium's loads.`,
      allowed:
        "Exclude `**/*.integration.test.ts` from the default lane and run them through a `test:integration` script and vitest.integration.config.ts, as modules/suite/process does.",
    }));
  return [...slow, ...live, ...containers];
}

/**
 * `pnpm test` and `nx run-many -t test` must finish without live services: a `test` lane
 * collects no scenario suite, waits at most two minutes per test, and, where the
 * package-suites job runs it, collects no suite that starts a container.
 */
export function lintDefaultTestLanes(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const excluded = excludedFromSuitesJob(snapshot.root);
  return readWorkspaceMembers(snapshot.root).flatMap((member) => {
    const script = testScriptOf(member.directory);
    const sharesShardWithBrowsers = !excluded.has(member.name);
    return script
      ? violationsFor({ directory: member.directory, script, sharesShardWithBrowsers })
      : [];
  });
}
