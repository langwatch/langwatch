/**
 * Keeps the "nothing on a handled error is sensitive" rule executable.
 * @vitest-environment node
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/**
 * The same three trees `codes.unit.test.ts` walks, for the same reason: a handled error declared in `ee/` or in a
 * workspace package reaches a customer exactly like one declared in `src/`, so a guard that only reads `src/` is
 * a guard that passes forever for everywhere else.
 */
const ROOTS = [
  join(PACKAGE_ROOT, "src"),
  // `ee` moved to `packages/enterprise` in `4faa77c658`, which the packages
  // root below already walks. Leaving it named did not shrink the corpus, it
  // threw ENOENT out of `walk` and took the whole guard with it.
  // Repo-root, not app-local: the workspace packages were consolidated into a
  // single `packages/` tree. See codes.unit.test.ts for the same walk.
  join(PACKAGE_ROOT, "../../packages"),
];

/**
 * Below this many messages, assume the extractor stopped matching rather than that the
 * codebase stopped raising handled errors. A scanner that finds nothing reports no
 * offenders.
 */
const MINIMUM_MESSAGES = 60;

/**
 * Shapes that can only have come from a config value, a deployment topology or a driver
 * — never from a sentence written for a customer.
 */
const FORBIDDEN: { label: string; pattern: RegExp }[] = [
  {
    label: "an environment variable name",
    // SCREAMING_SNAKE with at least one underscore: LW_GATEWAY_BASE_URL,
    // S3_SESSION_TOKEN, DATABASE_URL. A single word (API, URL, ID) is fine.
    pattern: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/,
  },
  {
    label: "a reference to process.env",
    pattern: /process\s*\.\s*env/,
  },
  {
    label: "an internal hostname",
    pattern: /\b[a-z0-9-]+\.(?:internal|local|localdomain|svc|cluster)\b/i,
  },
  {
    label: "a loopback or private address",
    pattern:
      /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/i,
  },
  {
    label: "a host:port pair",
    pattern: /\b[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+:\d{2,5}\b/i,
  },
];

/** The constructor forms that take a customer-facing message. */
const MESSAGE_CALLS = [
  // `super("code", "message", …)` — the subclass form, by far the commonest.
  /\bsuper\s*\(\s*(["'`])[a-z][a-z0-9_]*\1\s*,\s*/g,
  // `new HandledError("code", "message", …)` — a one-off with no subclass.
  /\bnew\s+HandledError\s*\(\s*(["'`])[a-z][a-z0-9_]*\1\s*,\s*/g,
];

function isTestFile(path: string): boolean {
  return path.includes("__tests__") || /\.test\.tsx?$/.test(path);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(path, out);
    } else if (/\.tsx?$/.test(entry.name) && !isTestFile(path)) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Reads the string or template literal starting at `from`, returning its literal text
 * (interpolations blanked) — or `null` when the argument is not a literal at all, which
 * is the `${}`-free half of the corpus this guard cannot see and does not pretend to.
 */
function readLiteral(source: string, from: number): string | null {
  const quote = source[from];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;

  let text = "";
  for (let at = from + 1; at < source.length; at++) {
    const char = source[at]!;
    if (char === "\\") {
      at++;
      continue;
    }
    if (char === quote) return text;
    // `${expr}` is a runtime value, not authored copy — skip it whole so a
    // variable named `BASE_URL` inside a template isn't read as prose.
    if (quote === "`" && char === "$" && source[at + 1] === "{") {
      let depth = 1;
      let scan = at + 2;
      while (scan < source.length && depth > 0) {
        if (source[scan] === "{") depth++;
        else if (source[scan] === "}") depth--;
        scan++;
      }
      at = scan - 1;
      continue;
    }
    text += char;
  }
  return null;
}

interface FoundMessage {
  file: string;
  line: number;
  message: string;
}

function collectMessages(): FoundMessage[] {
  const found: FoundMessage[] = [];

  for (const file of ROOTS.flatMap((root) => walk(root))) {
    const source = readFileSync(file, "utf8");
    // `super(` is far too common a shape to scan blind — only files that
    // actually deal in handled errors.
    if (!source.includes("@langwatch/handled-error")) continue;

    for (const pattern of MESSAGE_CALLS) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const at = match.index + match[0].length;
        const message = readLiteral(source, at);
        if (message === null) continue;
        found.push({
          file: relative(PACKAGE_ROOT, file),
          line: source.slice(0, at).split("\n").length,
          message,
        });
      }
    }
  }

  return found;
}

describe("a handled error's message", () => {
  describe("given every message a HandledError is constructed with", () => {
    it("reads a real corpus, not an empty one", () => {
      expect(
        collectMessages().length,
        `The extractor found almost no messages, so the assertion below passes ` +
          `vacuously. Check the roots resolve (${ROOTS.join(", ")}) and that ` +
          `the constructor forms still match.`,
      ).toBeGreaterThan(MINIMUM_MESSAGES);
    });

    /** @scenario A handled error's message is written to be safe to show */
    it("names no environment variable, internal host or address", () => {
      const offenders: string[] = [];

      for (const { file, line, message } of collectMessages()) {
        for (const { label, pattern } of FORBIDDEN) {
          const hit = pattern.exec(message);
          if (!hit) continue;
          offenders.push(`${file}:${line} — message names ${label} ("${hit[0]}"): ${message}`);
        }
      }

      expect(
        offenders,
        `A handled error's message is customer-safe by definition: the REST ` +
          `boundary ships it in the response body and the CLI/SDKs render it. ` +
          `Move the internal detail to the log line beside the throw — the ` +
          `trace id ties it back — and leave the message a sentence a customer ` +
          `could be shown. See dev/docs/best_practices/error-handling.md.`,
      ).toEqual([]);
    });
  });
});
