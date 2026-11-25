// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Where the name scorer is reached from, pinned by the static import graph.
 * Spec: specs/governance/governance-identity-match-engine.feature (ADR-128 §12)
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCORER = join(SRC, "features/identity/rules/name-similarity.rules.ts");
const SUGGESTION_JOB = join(SRC, "features/identity/services/identity-match-suggestion.service.ts");
const COMPOSITION_ROOT = join(SRC, "app/governance.app.ts");
const STATIC_IMPORT = /(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g;
const SCHEDULE_TOKENS = [/\.schedule\(/, /\beveryMs\b/, /\bonWake\b/, /\bcron\b/i];
const MATCHER_TOKENS = [
  /IdentityMatchSuggestionService/,
  /identityMatchSuggestions/,
  /linkProvenMatches/,
];

function sourceFiles({ dir = SRC }: { dir?: string } = {}): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles({ dir: path });
    return name.endsWith(".ts") && !name.includes(".test.") ? [path] : [];
  });
}

function importsOf({ file }: { file: string }): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(STATIC_IMPORT)]
    .map((match) => match[1] as string)
    .filter((specifier) => specifier.startsWith("."))
    .map((specifier) => resolve(dirname(file), specifier))
    .filter((path) => existsSync(path));
}

function importersOf({ target }: { target: string }): string[] {
  return sourceFiles()
    .filter((file) => importsOf({ file }).includes(target))
    .map((file) => relative(SRC, file))
    .toSorted();
}

function reachableFrom({ roots, leaf }: { roots: string[]; leaf: string }): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file) || file === leaf) continue;
    seen.add(file);
    queue.push(...importsOf({ file }));
  }
  return seen;
}

describe("the identity match engine's reach", () => {
  describe("given the background workers start", () => {
    /** @scenario "The matcher keeps no standing appointment of its own" */
    it("books no recurring matcher run, in any file that schedules anything", () => {
      const booking = sourceFiles().filter((file) => {
        const source = readFileSync(file, "utf8");
        return (
          SCHEDULE_TOKENS.some((token) => token.test(source)) &&
          MATCHER_TOKENS.some((token) => token.test(source))
        );
      });

      expect(booking.map((file) => relative(SRC, file))).toEqual([]);
    });

    it("finds the matcher in the composition root, so the scan is not reading nothing", () => {
      const source = readFileSync(COMPOSITION_ROOT, "utf8");

      expect(MATCHER_TOKENS.some((token) => token.test(source))).toBe(true);
    });
  });

  describe("given every path that serves a request", () => {
    it("has exactly the suggestion job importing the scorer", () => {
      expect(importersOf({ target: SCORER })).toEqual([
        "features/identity/services/identity-match-suggestion.service.ts",
      ]);
    });

    it("has exactly the composition root importing the suggestion job", () => {
      expect(importersOf({ target: SUGGESTION_JOB })).toEqual(["app/governance.app.ts"]);
    });

    /** @scenario "Nothing that answers a request ever compares two names" */
    it("never arrives at the scorer from a transport", () => {
      const roots = sourceFiles({ dir: join(SRC, "transport") });
      const reached = reachableFrom({ roots, leaf: COMPOSITION_ROOT });

      expect(roots.length).toBeGreaterThan(0);
      expect(reached.has(SCORER)).toBe(false);
      expect(reached.has(SUGGESTION_JOB)).toBe(false);
      expect([...reached].filter((file) => file.startsWith(join(SRC, "services")))).toEqual([]);
    });
  });
});
