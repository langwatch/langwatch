/**
 * @vitest-environment node
 * Guards the real-browser test lane, and keeps React testing dependencies in
 * the web packages that render React. See specs/ci/browser-test-lane.feature.
 */

import { globSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

const BROWSER_TEST_SCRIPT = "test:browser";
/** Mirrors BROWSER_TEST_GLOB in @langwatch/test-harness. */
const BROWSER_TEST_SUFFIX = ".browser.test.";

/**
 * Declaring any of these is declaring that the package renders React in a
 * test. A contract or server package that does is either testing a component
 * it has no business owning, or carrying a dependency nothing imports.
 */
const REACT_TEST_DEPENDENCIES = [
  "@testing-library/react",
  "@testing-library/jest-dom",
  "@testing-library/user-event",
  "vitest-browser-react",
] as const;

const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

interface PackageManifest {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface Member {
  dir: string;
  manifest: PackageManifest;
}

function workspaceMembers(): Member[] {
  const workspace = load(readFileSync(path.join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8")) as {
    packages: string[];
  };
  const members: Member[] = [];
  const seen = new Set<string>();
  for (const pattern of workspace.packages) {
    for (const dir of globSync(pattern, { cwd: REPO_ROOT })) {
      // A worktree under .claude/ is another checkout of this repository.
      if (dir.startsWith(".claude/") || seen.has(dir)) continue;
      const manifestPath = path.join(REPO_ROOT, dir, "package.json");
      if (!existsSync(manifestPath)) continue;
      seen.add(dir);
      members.push({ dir, manifest: JSON.parse(readFileSync(manifestPath, "utf8")) });
    }
  }
  return members.toSorted((a, b) => a.dir.localeCompare(b.dir));
}

/**
 * The packages that render React: a module's browser package — `browser`, or
 * a `browser-` prefixed sibling like `browser-kit` — the browser application,
 * and the shared UI packages. Everything else is a contract, a process
 * package or a tool.
 */
function isWebPackage(dir: string): boolean {
  const leaf = dir.slice(dir.lastIndexOf("/") + 1);
  return (
    leaf === "browser" ||
    leaf.startsWith("browser-") ||
    dir === "apps/ui" ||
    dir.startsWith("packages/")
  );
}

function declaredDependencies(manifest: PackageManifest): Set<string> {
  const names = new Set<string>();
  for (const field of DEP_FIELDS) {
    for (const name of Object.keys(manifest[field] ?? {})) names.add(name);
  }
  return names;
}

const MEMBERS = workspaceMembers();
const BROWSER_LANE = MEMBERS.filter((m) => m.manifest.scripts?.[BROWSER_TEST_SCRIPT]);

describe("React testing dependencies", () => {
  describe("given a workspace package that is not a web package", () => {
    /** @scenario "A server package may not declare a React testing dependency" */
    /** @scenario "A contract package may not declare a React testing dependency" */
    it("declares none of them", () => {
      const offenders = MEMBERS.filter((m) => !isWebPackage(m.dir)).flatMap((m) => {
        const declared = declaredDependencies(m.manifest);
        return REACT_TEST_DEPENDENCIES.filter((d) => declared.has(d)).map(
          (d) => `${m.dir} declares ${d}`,
        );
      });
      expect(offenders).toEqual([]);
    });
  });

  describe("given a web package", () => {
    /** @scenario "A web package may declare the React browser renderer" */
    it("may declare the React browser renderer", () => {
      const web = MEMBERS.filter((m) => isWebPackage(m.dir));
      expect(web.length).toBeGreaterThan(0);
      // The rule is one-directional: web packages are permitted these, not
      // required to have them. Asserting the permission means asserting that
      // the ones which do declare them are not reported as offenders.
      const reported = web.filter((m) => {
        const declared = declaredDependencies(m.manifest);
        return REACT_TEST_DEPENDENCIES.some((d) => declared.has(d));
      });
      expect(reported.length).toBeGreaterThan(0);
    });
  });
});

describe("the real-browser test lane", () => {
  describe("given a package declaring the browser lane", () => {
    /** @scenario "A package declaring the browser lane is discovered by CI" */
    it("is discovered by the script CI runs, by its manifest alone", () => {
      // `run-package-suites.ts` reads `test:browser` off the manifest, so
      // declaring the script IS being in CI. This asserts the two pilot
      // packages are visible to that rule rather than to a list.
      expect(BROWSER_LANE.map((m) => m.dir)).toEqual([
        "modules/analytics/browser",
        "modules/experiment/browser",
      ]);
    });

    it("declares the Playwright provider it runs through", () => {
      const missing = BROWSER_LANE.flatMap((m) => {
        const declared = declaredDependencies(m.manifest);
        return ["@vitest/browser-playwright", "playwright"]
          .filter((d) => !declared.has(d))
          .map((d) => `${m.dir} is missing ${d}`);
      });
      expect(missing).toEqual([]);
    });

    /** @scenario "A browser lane that collects no test files is a failure" */
    /** @scenario "A browser test outside the configured glob is reported" */
    it("contains at least one file the lane collects", () => {
      // Both pilots shipped a lane that ran nothing: one was invoked by no
      // workflow, the other's include glob named a directory it did not have.
      // A lane collecting zero files exits 0, so only this notices.
      const empty = BROWSER_LANE.filter(
        (m) =>
          globSync(`**/*${BROWSER_TEST_SUFFIX}{ts,tsx}`, {
            cwd: path.join(REPO_ROOT, m.dir),
            exclude: (p) => p.includes("node_modules") || p.includes("dist"),
          }).length === 0,
      ).map((m) => m.dir);
      expect(empty).toEqual([]);
    });

    /** @scenario "The browser lane installs its own browser" */
    it("installs its browser in its own script, not in a runner", () => {
      // The install belongs to the package because only the package resolves
      // the right playwright: there is none at the repo root, so an install
      // orchestrated from there picks up whatever is on PATH — a different
      // version whose browser build the lane then cannot find. In the script
      // it also survives whatever runs the suites, including nothing at all.
      const offenders = BROWSER_LANE.filter((m) => {
        const script = m.manifest.scripts?.[BROWSER_TEST_SCRIPT] ?? "";
        return !/playwright install\b/.test(script);
      }).map((m) => m.dir);
      expect(offenders).toEqual([]);
    });

    it("declares the browser config the script names", () => {
      const missing = BROWSER_LANE.filter(
        (m) => !existsSync(path.join(REPO_ROOT, m.dir, "vitest.browser.config.ts")),
      ).map((m) => m.dir);
      expect(missing).toEqual([]);
    });
  });

  describe("given a test file in the browser lane", () => {
    /** @scenario "A browser test does not import the jest-dom matchers" */
    it("does not import the jest-dom matchers the browser already supplies", () => {
      // `@vitest/browser` bundles the jest-dom matcher set. Importing it again
      // in a browser-lane file registers a second copy of matchers the runner
      // already has. The jsdom lane still needs it, so this is scoped to the
      // browser lane rather than applied repo-wide.
      const offenders = BROWSER_LANE.flatMap((m) =>
        globSync(`**/*${BROWSER_TEST_SUFFIX}{ts,tsx}`, {
          cwd: path.join(REPO_ROOT, m.dir),
          exclude: (p) => p.includes("node_modules") || p.includes("dist"),
        })
          .filter((file) =>
            readFileSync(path.join(REPO_ROOT, m.dir, file), "utf8").includes(
              "@testing-library/jest-dom",
            ),
          )
          .map((file) => `${m.dir}/${file}`),
      );
      expect(offenders).toEqual([]);
    });
  });

  describe("given a test file in the jsdom lane", () => {
    /** @scenario "A jsdom test keeps its jest-dom import" */
    it("keeps the jest-dom import, which only the browser lane supplies for itself", () => {
      // The matchers are built into `@vitest/browser`, not into vitest. Taking
      // the import out of a jsdom file removes the matchers outright, so the
      // removal is scoped to the browser lane — and the packages running both
      // lanes still declare the dependency for their jsdom half.
      const stillDeclared = BROWSER_LANE.filter((m) =>
        declaredDependencies(m.manifest).has("@testing-library/jest-dom"),
      ).map((m) => m.dir);
      expect(stillDeclared).toEqual(BROWSER_LANE.map((m) => m.dir));

      const jsdomImporters = BROWSER_LANE.flatMap((m) =>
        globSync("**/*.{test,spec}.{ts,tsx}", {
          cwd: path.join(REPO_ROOT, m.dir),
          exclude: (p) => p.includes("node_modules") || p.includes("dist"),
        })
          .filter((file) => !file.includes(BROWSER_TEST_SUFFIX))
          .filter((file) =>
            readFileSync(path.join(REPO_ROOT, m.dir, file), "utf8").includes(
              "@testing-library/jest-dom",
            ),
          ),
      );
      expect(jsdomImporters.length).toBeGreaterThan(0);
    });
  });
});
