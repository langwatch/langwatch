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

/** Files that call another server: a tunnel, a user's own HTTP agent. */
const NOT_LANGWATCH = new Set([
  "cli/commands/agents/dev.ts",
  "cli/commands/agents/run.ts",
]);

/** Test folders, the generated OpenAPI types, and the shared client itself. */
const SKIPPED = new Set(["internal/generated", "internal/http"]);

/** A call, a parameter default, or a fallback to the global. */
const RAW_FETCH = /(?<![\w.$])fetch\(|(?<![\w.$])=\s*fetch\s*[,;)]|\?\?\s*globalThis\.fetch\b|globalThis\.fetch\(/;

const isComment = (line: string): boolean => /^\s*(\*|\/\/|\/\*)/.test(line);

const isSource = (file: string): boolean =>
  file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith(".d.ts");

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== "__tests__" && !SKIPPED.has(relative(SRC_ROOT, path))) walk(path, out);
    } else if (isSource(path)) {
      out.push(path);
    }
  }
  return out;
};

const filesWithRawFetch = (): string[] =>
  walk(SRC_ROOT)
    .filter((file) => {
      const source = readFileSync(file, "utf8");
      return source
        .split("\n")
        .some((line) => !isComment(line) && RAW_FETCH.test(line));
    })
    .map((file) => relative(SRC_ROOT, file))
    .sort();

describe("the SDK source", () => {
  describe("given every file under src outside tests and generated code", () => {
    /** @scenario every hand written request uses the shared transport */
    it("sends every LangWatch request through langwatchFetch", () => {
      const offenders = filesWithRawFetch().filter((file) => !NOT_LANGWATCH.has(file));

      expect(
        offenders,
        "These files call fetch directly. Import langwatchFetch from @/internal/http/langwatchFetch instead, or add the file to NOT_LANGWATCH if it talks to another server.",
      ).toEqual([]);
    });

    it("keeps the list of non-LangWatch callers current", () => {
      const raw = new Set(filesWithRawFetch());
      const stale = [...NOT_LANGWATCH].filter((file) => !raw.has(file));

      expect(stale, "These files no longer call fetch directly. Remove them from NOT_LANGWATCH.").toEqual([]);
    });
  });
});
