/**
 * Every request the SDK sends to the LangWatch API goes through
 * `langwatchFetch`, which is what applies the redirect rule. A raw `fetch(`
 * call, or a `fetchImpl = fetch` default, anywhere else in `src` bypasses
 * that rule, so this test walks the source and fails on any it finds outside
 * the short list of calls that talk to something other than LangWatch.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const SRC_ROOT = resolve(__dirname, "..", "..", "..");

/**
 * Files that call another server, and how many raw calls each is allowed: a
 * tunnel probe, a user's own HTTP agent. A file is not exempt as a whole, so an
 * added call fails even here.
 */
const NOT_LANGWATCH = new Map([
  ["cli/commands/agents/dev.ts", 1],
  ["cli/commands/agents/run.ts", 1],
]);

/** The shared transport itself: the one file that reaches the global fetch. */
const TRANSPORT = "internal/http/langwatchFetch.ts";

/** Generated OpenAPI code, not hand written. */
const SKIPPED_DIRS = new Set(["internal/generated"]);

/** A call, a parameter default, or a fallback to the global. */
const RAW_FETCH = /(?<![\w.$])fetch\(|(?<![\w.$])=\s*fetch\s*[,;)]|\?\?\s*globalThis\.fetch\b|globalThis\.fetch\(/;

const isComment = (line: string): boolean => /^\s*(\*|\/\/|\/\*)/.test(line);

const isSource = (file: string): boolean =>
  file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith(".d.ts");

const walk = ({ dir, out = [] }: { dir: string; out?: string[] }): string[] => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== "__tests__" && !SKIPPED_DIRS.has(relative(SRC_ROOT, path))) {
        walk({ dir: path, out });
      }
    } else if (isSource(path)) {
      out.push(path);
    }
  }
  return out;
};

/** Every file that calls fetch directly, with how many such lines it has. */
const rawFetchCounts = (): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const file of walk({ dir: SRC_ROOT }).sort()) {
    const calls = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !isComment(line) && RAW_FETCH.test(line)).length;
    if (calls > 0) counts.set(relative(SRC_ROOT, file), calls);
  }
  return counts;
};

describe("the SDK source", () => {
  describe("given every file under src outside tests and generated code", () => {
    /** @scenario every hand written request uses the shared transport */
    it("sends every LangWatch request through langwatchFetch", () => {
      const offenders = [...rawFetchCounts()]
        .filter(([file, calls]) => {
          if (file === TRANSPORT) return false;
          return calls > (NOT_LANGWATCH.get(file) ?? 0);
        })
        .map(([file, calls]) => `${file} (${calls} calls)`);

      expect(
        offenders,
        "These files call fetch directly. Import langwatchFetch from @/internal/http/langwatchFetch instead, or raise the file's allowance in NOT_LANGWATCH if the new call talks to another server.",
      ).toEqual([]);
    });

    it("keeps the list of non-LangWatch callers current", () => {
      const counts = rawFetchCounts();
      const stale = [...NOT_LANGWATCH]
        .filter(([file, allowed]) => (counts.get(file) ?? 0) < allowed)
        .map(([file]) => file);

      expect(
        stale,
        "These files call fetch fewer times than NOT_LANGWATCH allows. Lower the allowance, or drop the entry.",
      ).toEqual([]);
    });

    it("keeps the shared transport as the only file reaching the global fetch", () => {
      expect(rawFetchCounts().has(TRANSPORT)).toBe(true);
    });
  });
});
