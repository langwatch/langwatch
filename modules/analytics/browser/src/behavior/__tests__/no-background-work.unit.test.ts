/**
 * The workbench talks to the server when asked, never otherwise. A behavioural test cannot
 * prove the absence of a schedule — only that the one it waited for did not fire — so this
 * reads the feature's own source instead, failing if a timer, poll or persistence call appears.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const FEATURE_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The workbench's files within the package: main's `features/analytics-query` scope. */
const WORKBENCH_FILE =
  /lwql|langwatch-ql|langwatch-vega|vega-lite|widget-granularity|widget-coarsened/;

/**
 * Skipped because this file has to spell the forbidden tokens out to look for
 * them. Nothing else is skipped.
 */
const SKIPPED_DIRECTORY = "__tests__";

const SOURCE_EXTENSIONS = [".ts", ".tsx"];

/**
 * Each entry is a way the surface could start working on its own, or remembering things the
 * feature does not promise to. A `pattern` marks a name that is only a problem when switched
 * on, so matching the bare name there would fail the feature for doing what it must do.
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
    const isSourceFile = SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension));
    if (isSourceFile && WORKBENCH_FILE.test(entry.name)) found.push(path);
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

describe("the feature's source", () => {
  describe("given it is inspected for schedules, background refreshes and persistence", () => {
    /** @scenario "The workbench has no unsolicited work or hidden client persistence" */
    it("contains none of them", () => {
      const files = sourceFiles(FEATURE_ROOT);

      // A scan that found nothing would pass vacuously, which is the one way
      // this test could go quietly useless.
      expect(files.length).toBeGreaterThanOrEqual(30);
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
