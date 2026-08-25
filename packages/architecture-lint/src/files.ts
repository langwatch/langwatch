import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".next-saas",
  "coverage",
  "dist",
  "node_modules",
]);

export function walkFiles(root: string, accept: (path: string) => boolean): string[] {
  const found: string[] = [];

  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile() && accept(path)) {
        found.push(path);
      }
    }
  };

  if (existsSync(root) && statSync(root).isDirectory()) visit(root);
  return found.sort();
}
