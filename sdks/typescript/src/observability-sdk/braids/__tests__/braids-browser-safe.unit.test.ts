import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const OBSERVABILITY_DIR = resolve(__dirname, "../..");
const IMPORT_PATTERN = /^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm;

function specifiersOf(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(IMPORT_PATTERN)].map((match) => match[1]!);
}

function resolveRelative({ from, specifier }: { from: string; specifier: string }): string {
  const base = resolve(dirname(from), specifier);
  const candidate = [`${base}.ts`, resolve(base, "index.ts")].find((path) => existsSync(path));
  if (!candidate) throw new Error(`cannot resolve ${specifier} from ${from}`);
  return candidate;
}

function reachableExternalSpecifiers(entry: string): Set<string> {
  const seen = new Set<string>();
  const external = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of specifiersOf(file)) {
      if (specifier.startsWith(".")) queue.push(resolveRelative({ from: file, specifier }));
      else external.add(specifier);
    }
  }
  return external;
}

const NODE_BUILTINS = ["crypto", "fs", "path", "os", "child_process", "http", "https", "stream"];

describe("the general observability entry's braid exports", () => {
  /** @scenario "The general observability entry's braid exports reach no Node built-in" */
  it("reach no Node built-in, and signing is exported from the Node entry", () => {
    const generalEntry = resolve(OBSERVABILITY_DIR, "index.ts");
    const braidSpecifiers = specifiersOf(generalEntry).filter((s) => s.includes("braids"));
    expect(braidSpecifiers).toEqual(["./braids"]);

    const external = reachableExternalSpecifiers(resolve(OBSERVABILITY_DIR, "braids/index.ts"));
    const nodeImports = [...external].filter(
      (s) => s.startsWith("node:") || NODE_BUILTINS.includes(s),
    );
    expect(nodeImports).toEqual([]);

    const nodeEntry = resolve(OBSERVABILITY_DIR, "setup/node/index.ts");
    expect(specifiersOf(nodeEntry)).toContain("../../braids/sign-baggage");
  });
});
