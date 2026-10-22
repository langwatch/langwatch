import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const searchRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Every package the island imports, following its relative imports through the source tree. */
function packagesOf({ entry }: { entry: string }) {
  const packages = new Set<string>();
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const [, kind, specifier] of source.matchAll(/^import (type )?[^;]*?from "([^"]+)"/gms)) {
      if (kind) continue;
      if (specifier.startsWith(".")) visit(path.resolve(path.dirname(file), specifier));
      else packages.add(specifier);
    }
  };
  visit(entry);
  return [...packages];
}

describe("when a reader opens search", () => {
  /** @scenario "Load the search engine without a schema library" */
  it("loads no schema validation library with the search island", () => {
    const packages = packagesOf({ entry: path.join(searchRoot, "browser/search.tsx") });
    expect(packages).toContain("react");
    expect(packages.filter((name) => name === "zod" || name.startsWith("zod/"))).toEqual([]);
  });
});
