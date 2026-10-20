#!/usr/bin/env node
// The root `tsc -b` without the test programs: every config the root solution reaches,
// minus tsconfig.test*.json and tsconfig.type-tests.json. Same projects, buildinfo and
// output as `pnpm typecheck`, so CI's full check still covers the tests
// (dev/docs/plans/typescript-cpu-and-check-time.md).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const readConfig = (file) =>
  JSON.parse(
    readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"])\/\/.*$/gm, "$1")
      .replace(/,(\s*[}\]])/g, "$1"),
  );
const configOf = (path) => {
  if (!existsSync(path)) return path;
  return statSync(path).isDirectory() ? join(path, "tsconfig.json") : path;
};
const isTest = (file) => /^tsconfig\.(tests?|type-tests)\.json$/.test(basename(file));

/** Every non-test config that compiles files, reached from the root solution. */
function sourcePrograms() {
  const seen = new Set();
  const found = [];
  const walk = (file) => {
    if (seen.has(file) || isTest(file)) return;
    if (!existsSync(file)) return;
    seen.add(file);
    const config = readConfig(file);
    for (const reference of config.references ?? []) {
      walk(configOf(resolve(dirname(file), reference.path)));
    }
    const container = Array.isArray(config.files) && config.files.length === 0;
    if (!container || (config.include ?? []).length > 0) found.push(file);
  };
  walk(join(root, "tsconfig.json"));
  return found.filter((file) => file !== join(root, "tsconfig.json"));
}

const outDir = join(root, "node_modules/.cache/langwatch");
mkdirSync(outDir, { recursive: true });
const solution = join(outDir, "tsconfig.src.json");
const references = sourcePrograms().map((file) => ({ path: relative(outDir, file) }));
writeFileSync(solution, `${JSON.stringify({ files: [], references }, null, 2)}\n`);
process.stderr.write(`typecheck:src: ${references.length} programs (tests skipped)\n`);
try {
  execFileSync(
    join(root, "node_modules/.bin/tsc"),
    ["-b", solution, "--builders", "1", "--checkers", "1"],
    { cwd: root, stdio: "inherit" },
  );
} catch (error) {
  process.exitCode = error.status ?? 1;
}
