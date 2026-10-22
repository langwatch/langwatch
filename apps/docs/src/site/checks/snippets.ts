import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { LinkIssue } from "./resolve.ts";

const IMPORT = /^\s*import\s+[^;]*?\s+from\s+["']([^"']*snippets\/[^"']+)["']/gm;
const SKIPPED = new Set(["node_modules", ".mintlify"]);

function authoredFiles({ directory }: { directory: string }): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || SKIPPED.has(entry.name)) return [];
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return authoredFiles({ directory: file });
    return /\.mdx?$/.test(entry.name) ? [file] : [];
  });
}

/** Every snippet an authored page or snippet imports must exist under the docs root. */
export function checkSnippets({ docsRoot }: { docsRoot: string }) {
  const issues: LinkIssue[] = [];
  let checked = 0;
  for (const file of authoredFiles({ directory: docsRoot })) {
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
      const specifier = match[1];
      checked += 1;
      const target = specifier.startsWith("/")
        ? path.join(docsRoot, specifier)
        : path.resolve(path.dirname(file), specifier);
      if (!existsSync(target))
        issues.push({
          source: path.relative(docsRoot, file),
          href: specifier,
          code: "missing-snippet",
        });
    }
  }
  return { checked, issues };
}
