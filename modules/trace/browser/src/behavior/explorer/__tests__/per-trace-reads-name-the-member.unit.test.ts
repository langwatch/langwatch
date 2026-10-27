/** @vitest-environment node */

/**
 * ADR-177 block F: every per-trace read the drawer makes names the member, or two members
 * holding one trace id show side by side. Reads the source: each call's input comes from
 * the drawer's `queryArgs` or names `tenantId`; a held input is followed to its declaration.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const BROWSER_SRC = path.resolve(import.meta.dirname, "../../..");

/** The per-trace procedures that take the member. */
const PER_TRACE_CALL =
  /\b(?:traces\.(?:header|spanTree|spanTreePaginated|spanTreeDelta|spansPaginated|spansDelta|spansFull|spanLangwatchSignals|codingAgentTranscript|spanDetail|resourceInfo|traceEvents|evals|traceLogs|conversationContext|getEvaluations)|evaluations\.getEvaluationInputs)\.(?:useQuery|useInfiniteQuery|useSuspenseQuery|prefetch|fetch|ensureData|setData)\s*\(/g;

/** What a member-naming input mentions. */
const NAMES_THE_MEMBER = /\b(?:queryArgs|tenantId|tenantArg)\b/;

function sourceFilesUnder(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      files.push(...sourceFilesUnder(full));
    } else if (
      // A shared trace has no member: its cache seeds are memberless by design.
      entry.name !== "seed-shared-trace.ts" &&
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name)
    ) {
      files.push(full);
    }
  }
  return files;
}

/** The source with comments blanked, offsets kept. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(
      /(^|[^:"'`])\/\/[^\n]*/g,
      (line, lead: string) => lead + " ".repeat(line.length - lead.length),
    );
}

/** The text of the first argument of the call whose `(` is at `open`. */
function firstArgument(code: string, open: number): string {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const ch = code[i];
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) return code.slice(open + 1, i);
    } else if (ch === "," && depth === 1) {
      return code.slice(open + 1, i);
    }
  }
  return code.slice(open + 1);
}

/** The initialiser of `const <name> =` in the same source, when there is one. */
function declarationOf(code: string, name: string): string | null {
  const at = code.search(new RegExp(`\\bconst\\s+${name}\\s*=`));
  if (at === -1) return null;
  const open = code.indexOf("=", at);
  const end = code.indexOf(";", open);
  return code.slice(open + 1, end === -1 ? undefined : end);
}

/** Every per-trace call whose input does not name the member, as `file:line`. */
function readsWithoutTheMemberIn({ file, source }: { file: string; source: string }): string[] {
  const code = withoutComments(source);
  const missing: string[] = [];
  for (const match of code.matchAll(PER_TRACE_CALL)) {
    const start = match.index as number;
    const open = start + match[0].length - 1;
    const argument = firstArgument(code, open).trim();
    // An input held in a variable, passed bare or spread in, is followed to
    // the variable's declaration.
    const held = /^[A-Za-z_$][\w$]*$/.test(argument)
      ? [argument]
      : [...argument.matchAll(/\.\.\.([A-Za-z_$][\w$]*)/g)].map((spread) => spread[1] as string);
    const followed = [argument, ...held.map((name) => declarationOf(code, name) ?? "")].join("\n");
    if (NAMES_THE_MEMBER.test(followed)) continue;
    const line = code.slice(0, start).split("\n").length;
    missing.push(`${file}:${line}`);
  }
  return missing;
}

describe("per-trace reads name the member", () => {
  describe("given the drawer's per-trace reads, prefetches and seeds", () => {
    /** @scenario "A trace id held by two members opens the member it was listed under" */
    it("builds every input from the drawer's arguments or names the member", () => {
      const files = sourceFilesUnder(BROWSER_SRC);
      const calls = files.flatMap((file) =>
        [...withoutComments(readFileSync(file, "utf8")).matchAll(PER_TRACE_CALL)].map(() => file),
      );
      // The scan must find the reads it guards, or "nothing missing" is vacuous.
      expect(calls.length).toBeGreaterThan(20);

      const missing = files.flatMap((file) =>
        readsWithoutTheMemberIn({
          file: path.relative(BROWSER_SRC, file),
          source: readFileSync(file, "utf8"),
        }),
      );

      expect(missing).toEqual([]);
    });
  });

  describe("given a read that drops the member", () => {
    it.each([
      {
        shape: "an inline input built from the project and trace alone",
        source: [
          "const query = api.traces.resourceInfo.useQuery(",
          "  { projectId, traceId, occurredAtMs },",
          "  { staleTime: 60_000 },",
          ");",
        ],
        expected: ["fixture.ts:1"],
      },
      {
        shape: "an input held in a variable that names no member",
        source: [
          "const input = { projectId, traceId: target.traceId };",
          "void utils.traces.spansFull.fetch(input);",
        ],
        expected: ["fixture.ts:2"],
      },
      {
        shape: "a comment that only mentions the member",
        source: [
          "void utils.traces.traceEvents.prefetch({",
          "  // tenantId is the caller's job",
          "  projectId,",
          "  traceId,",
          "});",
        ],
        expected: ["fixture.ts:1"],
      },
      {
        shape: "the drawer's arguments spread in",
        source: ["api.traces.spanDetail.useQuery({ ...queryArgs, spanId }, {});"],
        expected: [],
      },
      {
        shape: "a variable spread in that names no member",
        source: [
          "const input = { projectId, traceId };",
          "void utils.traces.header.prefetch({ ...input, full: true });",
        ],
        expected: ["fixture.ts:2"],
      },
      {
        shape: "an input held in a variable that names the member",
        source: [
          "const input = { projectId, traceId, ...tenantArg };",
          "void utils.traces.spanLangwatchSignals.prefetch(input, opts);",
        ],
        expected: [],
      },
    ])("reports $shape", ({ source, expected }) => {
      expect(
        readsWithoutTheMemberIn({
          file: "fixture.ts",
          source: source.join("\n"),
        }),
      ).toEqual(expected);
    });
  });
});
