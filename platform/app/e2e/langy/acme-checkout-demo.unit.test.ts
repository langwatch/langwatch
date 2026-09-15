/**
 * The ACME checkout demo stays a blank slate for Langy: no tracing, no tests,
 * no LangWatch dependency. The guided onboarding has Langy add all three, so
 * a dependency or an import that lands here would make that work a no-op.
 * These read the shipped tree, and the copy the scenario harness makes of it.
 *
 * @see specs/setup/acme-checkout-demo.feature
 */

import { existsSync, promises as fs, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  createDemoRepo,
  type DemoRepo,
  REPO_ROOT,
} from "./local-control-fixture";

const DEMO_DIR = path.join(
  REPO_ROOT,
  "dev",
  "dogfood",
  "acme-checkout",
  "python",
);

/** Anything that would make the demo traced or tested before Langy touches it. */
const FORBIDDEN_DEPENDENCY = /langwatch|opentelemetry|pytest|scenario/i;
const FORBIDDEN_IMPORT = /^\s*(?:from|import)\s+(?:langwatch|opentelemetry)\b/m;

const pythonFilesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".py"))
    .map((entry) => path.join(entry.parentPath, entry.name));

describe("the ACME checkout demo tree", () => {
  describe("when the source tree is scanned", () => {
    /** @scenario The application ships without tracing and without tests */
    it("names no tracing or test dependency, imports none, and says so in the README", () => {
      const pyproject = readFileSync(
        path.join(DEMO_DIR, "pyproject.toml"),
        "utf8",
      );
      expect(pyproject).not.toMatch(FORBIDDEN_DEPENDENCY);
      expect(pyproject).not.toMatch(/dependency-groups|optional-dependencies/);

      const sources = pythonFilesUnder(path.join(DEMO_DIR, "app"));
      expect(sources.length).toBeGreaterThan(0);
      for (const file of sources) {
        expect(readFileSync(file, "utf8"), file).not.toMatch(FORBIDDEN_IMPORT);
        expect(path.basename(file)).not.toMatch(/^test_|_test\.py$/);
      }
      expect(existsSync(path.join(DEMO_DIR, "tests"))).toBe(false);

      const readme = readFileSync(path.join(DEMO_DIR, "README.md"), "utf8");
      expect(readme).toContain("sends no traces");
      expect(readme).toContain("has no tests");
      expect(readme).toContain("on purpose");
    });
  });
});

describe("the scenario harness", () => {
  let repo: DemoRepo | undefined;

  afterAll(async () => {
    if (!repo) return;
    await fs.rm(repo.root, { recursive: true, force: true });
    await fs.rm(repo.remote, { recursive: true, force: true });
  });

  describe("when a scenario creates a demo repository in the langgraph language", () => {
    /** @scenario The scenario harness copies it into a temporary repository */
    it("makes a git repository on main with the sources and the manifest exactly as shipped", async () => {
      repo = await createDemoRepo({
        language: "langgraph",
        name: "checkout-copy",
        install: false,
      });

      expect(repo.currentBranch()).toBe("main");
      expect(repo.log()).toEqual(["chore: the ACME checkout agent"]);
      expect(repo.status()).toBe("");

      for (const file of [
        "README.md",
        "pyproject.toml",
        "app/graph.py",
        "app/main.py",
        "app/store.py",
      ]) {
        expect(repo.exists(file), file).toBe(true);
      }
      expect(repo.exists(".venv")).toBe(false);
      expect(repo.exists(".env")).toBe(false);

      const shipped = readFileSync(
        path.join(DEMO_DIR, "pyproject.toml"),
        "utf8",
      );
      expect(repo.read("pyproject.toml")).toBe(shipped);
      expect(repo.read("pyproject.toml")).not.toContain("sdks/python");
    });
  });
});
