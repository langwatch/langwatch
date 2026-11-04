import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Every package a browser island imports, following its relative imports and the re-exports of
 * feature entries through the source tree.
 */
export function islandPackages({ entry }: { entry: string }) {
  const packages = new Set<string>();
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const [, kind, specifier = ""] of source.matchAll(
      /^(?:import|export) (type )?[^;]*?from "([^"]+)"/gms,
    )) {
      if (kind) continue;
      if (specifier.startsWith(".")) visit(path.resolve(path.dirname(file), specifier));
      else packages.add(specifier);
    }
  };
  visit(entry);
  return [...packages];
}

/** The packages that would bring a component runtime or the design system into an island. */
export const COMPONENT_RUNTIME =
  /^(react|preact|@chakra-ui|@emotion|@ark-ui|@zag-js|@langwatch\/design-system)/;
