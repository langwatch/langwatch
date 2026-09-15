/**
 * Only the cost screen reads the person figures over the whole organization.
 *
 * `activityMonitor.spendByUser` feeds four screens. ADR-128 ruling 8 turned
 * the cost screen's panel into a token panel and left the other three on
 * dollars, and ruling 6 forbids a money figure moving as a side effect of a
 * fix aimed elsewhere. The organization scope therefore belongs to exactly one
 * of the four call sites: the rest keep the hidden governance project and the
 * governance-source filter, which is what the server gives a caller that names
 * no scope at all.
 *
 * WHY A SOURCE SCAN AND NOT FOUR MOUNTED PAGES. What is being pinned is which
 * call sites opted in, and a page test can only speak for the page it mounts —
 * a fifth caller added next quarter is invisible to all four of them. This
 * walks every file that makes the call, so an opt-in written anywhere fails
 * here. The runtime behaviour the opt-in selects is proved a level down, in
 * `activityMonitorSpendByUserScope.unit.test.ts` and
 * `activityMonitorSpendByUserOriginFilter.unit.test.ts`; this file proves only
 * who asked for it.
 *
 * THE SELF-CHECK. A scan that stops matching reports no offenders and stays
 * green forever, so {@link CALL_SITE_FLOOR} fails the file if the call has
 * been renamed out from under it rather than reporting a clean sweep.
 *
 * Spec: specs/governance/governance-cost-screen.feature — rule "A people panel
 * measures tokens and says which store it read".
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** Both trees that ship UI; the governance screens are split across them. */
const ROOTS = ["src", "ee"].map((dir) => join(PACKAGE_ROOT, dir));

/** The call this file is about, spelled the one way the codebase spells it. */
const CALL = "api.activityMonitor.spendByUser.useQuery(";

/** The opt-in, as it appears in the argument object of that call. */
const ORGANIZATION_SCOPE = /scope:\s*["']organization["']/;

/**
 * The one call site allowed to opt in, as a path relative to the package.
 * A second entry here is a deliberate decision that has to be argued in the
 * ADR, not a diff nobody noticed.
 */
const ALLOWED = ["src/pages/governance/costs.tsx"];

/**
 * Below this many call sites, assume the call was renamed rather than that the
 * screens stopped reading it. Four exist today.
 */
const CALL_SITE_FLOOR = 4;

/** Every source file under the UI trees, tests excluded. */
function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      yield* sourceFiles(full);
      continue;
    }
    if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      yield full;
    }
  }
}

/**
 * The argument text of each `spendByUser.useQuery(` call in a file.
 *
 * Read by counting brackets from the opening parenthesis rather than by a
 * fixed window, so a call whose options object grows past whatever a window
 * guessed still has its scope read.
 */
function callArguments(source: string): string[] {
  const found: string[] = [];
  let from = source.indexOf(CALL);
  while (from !== -1) {
    let depth = 0;
    let cursor = from + CALL.length - 1;
    for (; cursor < source.length; cursor++) {
      const char = source[cursor];
      if (char === "(") depth++;
      else if (char === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    found.push(source.slice(from, cursor + 1));
    from = source.indexOf(CALL, cursor + 1);
  }
  return found;
}

/** Every file making the call, and whether any of its calls opted in. */
function scanCallSites(): Array<{ file: string; optsIn: boolean }> {
  const sites: Array<{ file: string; optsIn: boolean }> = [];
  for (const root of ROOTS) {
    for (const file of sourceFiles(root)) {
      const source = readFileSync(file, "utf8");
      if (!source.includes(CALL)) continue;
      sites.push({
        file: relative(PACKAGE_ROOT, file),
        optsIn: callArguments(source).some((args) =>
          ORGANIZATION_SCOPE.test(args),
        ),
      });
    }
  }
  return sites;
}

describe("which screens read the person figures over the whole organization", () => {
  describe("given every screen that reads the per-person figures", () => {
    /** @scenario "The panel counting people covers every project of the organization" */
    it("finds the call sites it is meant to be judging", () => {
      const sites = scanCallSites();

      // Without this the guard passes by matching nothing.
      expect(sites.length).toBeGreaterThanOrEqual(CALL_SITE_FLOOR);
    });

    /** @scenario "A reader of the person figures other than the cost screen keeps the governance scope" */
    it("lets only the cost screen ask for the organization scope", () => {
      const optedIn = scanCallSites()
        .filter((site) => site.optsIn)
        .map((site) => site.file)
        .sort();

      expect(optedIn).toEqual(ALLOWED);
    });
  });
});
