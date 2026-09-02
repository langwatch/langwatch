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
 * Spec: packages/features/analytics/specs/analytics-lwql-workbench.feature
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
 *
 * `token` is the name to look for. An entry may also carry a `pattern`, which
 * is then what decides the offence: some of these names are only a problem
 * when they are switched on, and the source is expected to carry them turned
 * off. Matching the bare name there would fail the feature for doing the very
 * thing this file exists to require.
 */
const FORBIDDEN: readonly {
  token: string;
  because: string;
  pattern?: RegExp;
}[] = [
  {
    token: "setInterval",
    because: "a timer would rerun work nobody asked for",
  },
  {
    token: "setTimeout",
    because: "a self-rescheduling timeout is a poll under another name",
  },
  {
    token: "refetchInterval",
    because: "a polling query would rerun the SQL on a schedule",
  },
  {
    token: "refetchOnWindowFocus",
    pattern: /refetchOnWindowFocus:(?!\s*false\b)/,
    because: "returning to the tab must not rerun the SQL on its own",
  },
  {
    token: "refetchOnMount",
    pattern: /refetchOnMount:(?!\s*false\b)/,
    because: "remounting the surface must not rerun the SQL on its own",
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
    token: "@langwatch/langy-contract",
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

function offencesInSource(source: string): string[] {
  return FORBIDDEN.filter(({ token, pattern }) =>
    pattern ? pattern.test(source) : source.includes(token),
  ).map(({ token, because }) => `${token} (${because})`);
}

function offencesIn(files: readonly string[]): string[] {
  return files.flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return offencesInSource(source).map(
      (offence) => `${file.slice(FEATURE_ROOT.length)}: ${offence}`,
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

  describe("given the scan itself is put in front of the promise it makes", () => {
    it("catches a timer that reschedules itself", () => {
      expect(offencesInSource("setTimeout(() => poll(), 1000);")).not.toEqual([]);
    });

    it("catches a refetch the member did not ask for", () => {
      expect(offencesInSource("refetchOnWindowFocus: true,")).not.toEqual([]);
      expect(offencesInSource("refetchOnMount: always,")).not.toEqual([]);
    });

    it("leaves a refetch that is switched off alone", () => {
      expect(offencesInSource("refetchOnWindowFocus: false,\nrefetchOnMount: false")).toEqual([]);
    });
  });
});
