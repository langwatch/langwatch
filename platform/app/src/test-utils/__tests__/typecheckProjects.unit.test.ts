/**
 * How the repository's TypeScript is split into projects.
 *
 * There are three: the app alone, the tests alone, and the union that
 * `typecheck:all` runs. The union exists because every test file imports the
 * app, so checking the two separately loads the app's files twice.
 *
 * The parity check is the assertion that matters: it loads all three programs
 * and fails if the union leaves any file unchecked. The others alongside it
 * only say the config still reads the way it was written.
 *
 * Spec: specs/setup/typescript-7.feature
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** platform/app/, from src/test-utils/__tests__/. */
const APP_ROOT = resolve(__dirname, "../../..");
const REPO_ROOT = resolve(APP_ROOT, "../..");

const APP_PROJECT = "tsconfig.tsgo.json";
const TESTS_PROJECT = "tsconfig.tsgo.tests.json";
const ALL_PROJECT = "tsconfig.tsgo.all.json";

/** tsconfig files carry comments, which `JSON.parse` will not take. */
function readProject(name: string): Record<string, any> {
  const text = readFileSync(resolve(APP_ROOT, name), "utf8");
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));
}

/**
 * The compiler, skipping the check queue where that is possible.
 *
 * `dev/scripts/install-check-shims.mjs` renames the real binary to `tsc.real`
 * and puts a queueing shim at `tsc`, so on a developer machine `tsc.real` is
 * what runs a program without taking a machine-wide slot. The installer stands
 * down when `CI` is set, so there the plain name is the real binary and
 * `tsc.real` does not exist at all.
 */
function compilerBin(): string {
  const real = resolve(APP_ROOT, "node_modules/.bin/tsc.real");
  return existsSync(real) ? real : resolve(APP_ROOT, "node_modules/.bin/tsc");
}

/** The set of files a project puts in its program. */
function programFiles(project: string): Set<string> {
  const stdout = execFileSync(
    compilerBin(),
    ["--noEmit", "--project", `./${project}`, "--listFilesOnly"],
    {
      cwd: APP_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      // A queueing shim would otherwise serialise the three loads behind
      // whatever else holds a slot, and it exports this to its own children.
      env: { ...process.env, CHECK_SLOTS: "0" },
    },
  );
  return new Set(stdout.split("\n").filter((line) => line.trim() !== ""));
}

describe("given the repository's typecheck projects", () => {
  describe("when the whole repository is typechecked", () => {
    // @scenario "The whole repository is typechecked as one program"
    it("runs one project that covers the app and its tests", () => {
      const pkg = JSON.parse(
        readFileSync(resolve(APP_ROOT, "package.json"), "utf8"),
      );
      const script = pkg.scripts["typecheck:all"];
      // Naming the project is not enough: it has to be handed to the compiler
      // as the project to check, with no emit.
      expect(script).toMatch(/(^|[/\s])tsc\b/);
      expect(script).toContain("--noEmit");
      expect(script).toContain(`--project ./${ALL_PROJECT}`);
      // Two invocations chained would be the two-program shape again.
      expect(script).not.toContain("&&");
    });

    // @scenario "The whole repository is typechecked as one program"
    it("is what CI runs, so local and CI check the same program", () => {
      const workflow = readFileSync(
        resolve(REPO_ROOT, ".github/workflows/langwatch-app-ci.yml"),
        "utf8",
      );
      expect(workflow).toContain("pnpm run typecheck:all");
      expect(workflow).not.toContain("pnpm run typecheck:tests");
    });

    // @scenario "Checking one project does not cool another"
    it("gives each project a build info file of its own", () => {
      const paths = [APP_PROJECT, TESTS_PROJECT, ALL_PROJECT].map(
        (p) => readProject(p).compilerOptions?.tsBuildInfoFile,
      );
      expect(paths.every((p) => typeof p === "string" && p.length > 0)).toBe(
        true,
      );
      expect(new Set(paths).size).toBe(paths.length);
    });
  });

  describe("when the combined project replaces the two it merges", () => {
    // @scenario "The combined project checks every file the split projects checked"
    it("leaves no file that was checked before unchecked", () => {
      expect(existsSync(resolve(APP_ROOT, ALL_PROJECT))).toBe(true);

      const combined = programFiles(ALL_PROJECT);
      const covered = [
        ...programFiles(APP_PROJECT),
        ...programFiles(TESTS_PROJECT),
      ];

      const dropped = covered.filter((file) => !combined.has(file));
      expect(
        dropped,
        "the combined project must be a superset: these files lose their typecheck",
      ).toEqual([]);
    });
  });
});
