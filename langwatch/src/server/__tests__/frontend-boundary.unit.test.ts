/**
 * @vitest-environment node
 *
 * @see specs/setup/memory-footprint.feature — "Server code cannot reach
 * browser-only UI, even transitively"
 *
 * An architectural guard, not a snapshot. It walks the real import graph the
 * way Node does and fails with the offending chain.
 *
 * It has to be transitive, because the leak it prevents was invisible to a
 * direct-import check: `routes/evaluations-legacy.ts` imported one display-name
 * constant from a React component, and that single hop pulled Chakra UI, Ark
 * UI, Emotion, react-dom and react-router — ~1,320 modules of browser-only code
 * — into the API, worker, and ingestion processes alike.
 *
 * Only *value* imports are followed: `import type` is erased at compile time
 * and cannot pull a module at runtime, so a server file may freely name a
 * component's types.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Packages that only make sense in a browser. Prefix-matched on the specifier. */
const BROWSER_ONLY = [
  "react",
  "react-dom",
  "react-router",
  "react-feather",
  "framer-motion",
  "@chakra-ui",
  "@ark-ui",
  "@emotion",
  "@zag-js",
];

/**
 * Server-rendered email templates are React by design (react-email renders them
 * to HTML at send time), so React is legitimate there and nowhere else. They are
 * allowed *terminals*: the walk stops on entry, so a service that sends mail is
 * not reported for the React its templates legitimately use.
 */
const ALLOWED_PREFIXES = ["server/mailer/"];

const isAllowedTerminal = (file: string) =>
  ALLOWED_PREFIXES.some((p) => rel(file).startsWith(p));

/** Backend trees: nothing under these may reach a browser-only package. */
const BACKEND_TREES = ["server", path.join("app", "api"), "mcp"];

const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");

const isSource = (f: string) =>
  /\.tsx?$/.test(f) &&
  !f.endsWith(".d.ts") &&
  !/\.(test|spec)\.tsx?$/.test(f) &&
  !f.includes(`${path.sep}__tests__${path.sep}`) &&
  !f.includes(`${path.sep}__mocks__${path.sep}`);

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (isSource(full)) out.push(full);
  }
  return out;
};

const contents = new Map<string, string>();
const read = (file: string): string => {
  let c = contents.get(file);
  if (c === undefined) {
    c = fs.readFileSync(file, "utf8");
    contents.set(file, c);
  }
  return c;
};

/**
 * Specifiers this file imports for their *runtime value*. `import type {...}`
 * and `export type {...}` are skipped; inline `{ type A, b }` still counts,
 * because `b` is a value.
 */
const valueImportsOf = (file: string): string[] => {
  const source = read(file);
  const specs: string[] = [];

  // Side-effect imports: `import "x"`.
  for (const [, spec] of source.matchAll(
    /(?:^|\n)\s*import\s+["']([^"']+)["']/g,
  )) {
    if (spec) specs.push(spec);
  }
  // Bound imports/re-exports: `import ... from "x"` / `export ... from "x"`.
  for (const [, clause, spec] of source.matchAll(
    /(?:^|\n)\s*(?:import|export)\s+([^;'"]*?)\s*from\s*["']([^"']+)["']/g,
  )) {
    if (!spec) continue;
    if (clause && /^type\s/.test(clause.trim())) continue; // erased at compile time
    specs.push(spec);
  }
  return specs;
};

const CANDIDATE_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  "/index.ts",
  "/index.tsx",
];

/** Resolve an app-internal specifier to a file, or null if it is a package. */
const resolveAppImport = (spec: string, fromFile: string): string | null => {
  let base: string;
  if (spec.startsWith("~/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // bare specifier — a package, handled by BROWSER_ONLY

  // ESM-style ".js" specifiers point at TypeScript sources on disk.
  const withoutJs = base.replace(/\.js$/, "");
  for (const candidate of [base, withoutJs]) {
    for (const suffix of CANDIDATE_SUFFIXES) {
      const full = candidate + suffix;
      if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
    }
  }
  return null;
};

const bannedPackage = (spec: string): string | null =>
  BROWSER_ONLY.find((p) => spec === p || spec.startsWith(`${p}/`)) ?? null;

const memo = new Map<string, string[] | null>();

/**
 * A chain from `file` to a browser-only package, or null if it cannot reach one.
 *
 * `cycles.hit` tracks whether the answer depended on cutting an import cycle —
 * and this codebase has them (see ADR-058 on `app-layer` ↔ `event-sourcing`). A
 * "cannot reach" computed under a cut cycle may be incomplete, so it is not
 * cached; caching it could hide a real leak behind a cycle. Found chains are
 * always sound, so those cache unconditionally.
 */
const chainToBrowserUi = (
  file: string,
  stack = new Set<string>(),
  cycles = { hit: false },
): string[] | null => {
  const cached = memo.get(file);
  if (cached !== undefined) return cached;
  if (stack.has(file)) {
    cycles.hit = true;
    return null;
  }

  stack.add(file);
  const childCycles = { hit: false };
  let result: string[] | null = null;
  for (const spec of valueImportsOf(file)) {
    const banned = bannedPackage(spec);
    if (banned) {
      result = [rel(file), banned];
      break;
    }
    const target = resolveAppImport(spec, file);
    if (!target || isAllowedTerminal(target)) continue;
    const downstream = chainToBrowserUi(target, stack, childCycles);
    if (downstream) {
      result = [rel(file), ...downstream];
      break;
    }
  }
  stack.delete(file);

  if (result !== null || !childCycles.hit) memo.set(file, result);
  else cycles.hit = true; // inconclusive here, so it is inconclusive for our caller too

  return result;
};

const backendFiles = BACKEND_TREES.flatMap((tree) => {
  const dir = path.join(SRC, tree);
  return fs.existsSync(dir) ? walk(dir) : [];
});

describe("browser-only UI never reaches the backend", () => {
  describe("given the import graph rooted at every backend source file", () => {
    it("finds no chain from server code into a browser-only package", () => {
      const violations = backendFiles
        .filter((f) => !isAllowedTerminal(f))
        .map((f) => chainToBrowserUi(f))
        .filter((chain): chain is string[] => chain !== null)
        .map((chain) => chain.join("\n     -> "));

      expect(violations).toEqual([]);
    });
  });

  // Without this, a regex that silently stopped matching would make the guard
  // above pass vacuously.
  describe("given a component that genuinely renders Chakra", () => {
    it("still reports a chain, proving the walker resolves imports", () => {
      const component = path.join(SRC, "components/checks/EvaluatorSelection.tsx");
      expect(fs.existsSync(component)).toBe(true);

      expect(chainToBrowserUi(component)).not.toBeNull();
    });
  });

  describe("given a type-only import of a component", () => {
    it("does not count it, because types are erased", () => {
      const specs = valueImportsOf(
        path.join(SRC, "server/traces/types.ts"),
      );

      expect(specs).not.toContain("~/components/messages/MessageCard");
    });
  });
});
