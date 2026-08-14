/**
 * The workbench talks to the server when the member asks it to, and never
 * otherwise.
 *
 * A behavioural test cannot prove the absence of a schedule — it can only prove
 * that the one it happened to wait for did not fire. So this reads the feature's
 * own source instead, and fails the moment a timer, a polling option or a
 * persistence call appears anywhere in it.
 *
 * Scanning the whole feature directory's production source, excluding every
 * `__tests__` directory, is deliberate: the promise is about the surface, not
 * about the file that happens to hold the request state today.
 *
 * Spec: specs/analytics/governed-sql-workbench.feature
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const FEATURE_ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Skipped because this file has to spell the forbidden tokens out to look for
 * them. Nothing else is skipped.
 */
const SKIPPED_DIRECTORY = "__tests__";

const SOURCE_EXTENSIONS = [".ts", ".tsx"];

/**
 * Each entry is a way the surface could start working on its own, or start
 * remembering things the feature does not promise to remember.
 */
const FORBIDDEN: readonly { token: string; because: string }[] = [
  {
    token: "setInterval",
    because: "a timer would rerun work nobody asked for",
  },
  {
    token: "refetchInterval",
    because: "a polling query would rerun the SQL on a schedule",
  },
  {
    token: "localStorage",
    because: "the workbench persists nothing between visits",
  },
  {
    token: "sessionStorage",
    because: "the workbench persists nothing between visits",
  },
  {
    token: "indexedDB",
    because: "the workbench persists nothing between visits",
  },
  {
    token: "document.cookie",
    because:
      "the specification the member is editing is never written anywhere " +
      "by the chart surface itself",
  },
  {
    token: "features/langy",
    because: "the workbench exposes no agent surface",
  },
  {
    token: "@langwatch/langy",
    because: "the workbench exposes no agent surface",
  },
];

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === SKIPPED_DIRECTORY) continue;
      found.push(...sourceFiles(path));
      continue;
    }
    if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      found.push(path);
    }
  }
  return found;
}

function offencesIn(files: readonly string[]): string[] {
  return files.flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return FORBIDDEN.filter(({ token }) => source.includes(token)).map(
      ({ token, because }) =>
        `${file.slice(FEATURE_ROOT.length)}: ${token} (${because})`,
    );
  });
}

describe("the workbench feature's source", () => {
  describe("given it is inspected for schedules, background refreshes and persistence", () => {
    /** @scenario "The workbench ships no polling, browser-side persistence, export, or agent surface" */
    it("contains none of them", () => {
      const files = sourceFiles(FEATURE_ROOT);

      // A scan that found nothing would pass vacuously, which is the one way
      // this test could go quietly useless.
      expect(files.length).toBeGreaterThanOrEqual(8);
      expect(offencesIn(files)).toEqual([]);
    });
  });
});
