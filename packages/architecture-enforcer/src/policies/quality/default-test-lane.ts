import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, matchesGlob, relative } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation } from "../../types.ts";
import { sourceFile } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import { readWorkspaceMembers } from "../../workspace/tsconfig-references.ts";

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
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".git", ".claude"]);

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

function scenarioFiles(directory: string, base = directory): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return SKIPPED_DIRECTORIES.has(entry.name)
        ? []
        : scenarioFiles(join(directory, entry.name), base);
    }
    return SCENARIO_FILE.test(entry.name) ? [relative(base, join(directory, entry.name))] : [];
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

function violationsFor(directory: string, script: string): ArchitectureViolation[] {
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
  const live = scenarioFiles(directory)
    .filter((scenario) => collects(lane, scenario))
    .map((scenario) => ({
      policy: POLICY,
      file: join(directory, scenario),
      message: `The default test lane collects ${scenario}, a scenario suite that drives live services.`,
      allowed:
        "Exclude `**/*.scenario.test.*` from the default lane and run scenarios through their own script and config.",
    }));
  return [...slow, ...live];
}

/**
 * `pnpm test` and `nx run-many -t test` must finish without live services, so
 * the lane a package's `test` script runs never collects a scenario suite and
 * never waits more than two minutes for one test.
 */
export function lintDefaultTestLanes(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return readWorkspaceMembers(snapshot.root).flatMap((member) => {
    const script = testScriptOf(member.directory);
    return script ? violationsFor(member.directory, script) : [];
  });
}
