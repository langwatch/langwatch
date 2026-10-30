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

type NamedScript = { name: string; script: string };

/** A script that only runs `pnpm test` or `pnpm test:unit` (also npm, yarn, `run`). */
const HAND_OFF = /^(?:pnpm|npm|yarn)(?: run)? (test:unit|test)(?=\s|$)/;

/**
 * The vitest script `name` runs, following hand-offs to `test` or `test:unit`.
 * Undefined when the chain ends in another runner or loops.
 */
function vitestScriptOf({
  scripts,
  name,
  seen = new Set<string>(),
}: {
  scripts: Record<string, string>;
  name: string;
  seen?: Set<string>;
}): NamedScript | undefined {
  const script = scripts[name];
  if (!script || seen.has(name)) return undefined;
  if (script.includes("vitest")) return { name, script };
  const target = HAND_OFF.exec(script)?.[1];
  return target ? vitestScriptOf({ scripts, name: target, seen: seen.add(name) }) : undefined;
}

/** A vitest lane with the test files it collects, computed once and shared by every check. */
type CollectedLane = NamedScript & { lane: Lane; collected: string[] };

function scriptsOf(directory: string): Record<string, string> {
  const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  return manifest.scripts ?? {};
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

function defaultLaneViolations({
  directory,
  name,
  lane,
  collected,
}: CollectedLane & { directory: string }): ArchitectureViolation[] {
  const file = lane.config ?? join(directory, "package.json");
  const slow =
    lane.timeoutMs !== undefined && lane.timeoutMs > TIMEOUT_CEILING_MS
      ? [
          {
            policy: POLICY,
            file,
            message: `The \`${name}\` lane waits ${lane.timeoutMs} ms per test; a suite that needs longer than ${TIMEOUT_CEILING_MS} ms belongs in its own lane.`,
            allowed: `Move the slow suite to a vitest.<lane>.config file run by its own script, and keep \`${name}\` under two minutes per test.`,
          },
        ]
      : [];
  const live = collected
    .filter((test) => SCENARIO_FILE.test(test))
    .map((scenario) => ({
      policy: POLICY,
      file: join(directory, scenario),
      message: `The \`${name}\` lane collects ${scenario}, a scenario suite that drives live services.`,
      allowed: `Exclude \`**/*.scenario.test.*\` from the \`${name}\` lane and run scenarios through their own script and config.`,
    }));
  return [...slow, ...live];
}

function containerViolations({
  directory,
  name,
  collected,
}: CollectedLane & { directory: string }): ArchitectureViolation[] {
  return collected
    .filter((test) => !SCENARIO_FILE.test(test) && startsContainers(join(directory, test)))
    .map((test) => ({
      policy: POLICY,
      file: join(directory, test),
      message: `The \`${name}\` lane collects ${test}, which starts a container. In CI that lane runs beside browser suites, and a container's network change aborts Chromium's loads.`,
      allowed: `Move ${test} out of the \`${name}\` lane (exclude it, or rename it to *.integration.test.ts and exclude that glob) and run it through a \`test:integration\` script.`,
    }));
}

function packageViolations({
  directory,
  inSuitesJob,
}: {
  directory: string;
  inSuitesJob: boolean;
}): ArchitectureViolation[] {
  const scripts = scriptsOf(directory);
  const test = vitestScriptOf({ scripts, name: "test" });
  const ci = vitestScriptOf({ scripts, name: scripts["test:unit"] ? "test:unit" : "test" });
  const distinct = [...new Map([ci, test].flatMap((lane) => (lane ? [[lane.script, lane]] : [])))];
  if (distinct.length === 0) return [];
  const tests = testFiles(directory);
  const lanes = distinct.map(([, named]): CollectedLane => {
    const lane = laneOf(directory, named.script);
    return { ...named, lane, collected: tests.filter((file) => collects(lane, file)) };
  });
  const containerLane = inSuitesJob ? lanes.find(({ script }) => script === ci?.script) : undefined;
  return [
    ...lanes.flatMap((lane) => defaultLaneViolations({ directory, ...lane })),
    ...(containerLane ? containerViolations({ directory, ...containerLane }) : []),
  ];
}

/**
 * Every vitest lane (`test`, `test:unit`) collects no scenario suite and waits at most two
 * minutes per test; the suites-job lane (`test:unit` else `test`) starts no container.
 * Hand-offs resolve to the script they run; a lane without vitest is skipped.
 */
export function lintDefaultTestLanes(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const excluded = excludedFromSuitesJob(snapshot.root);
  return readWorkspaceMembers(snapshot.root).flatMap((member) =>
    packageViolations({ directory: member.directory, inSuitesJob: !excluded.has(member.name) }),
  );
}
