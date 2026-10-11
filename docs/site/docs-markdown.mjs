import { readFileSync } from "node:fs";
import path from "node:path";

export function pageMarkdown({ docsRoot, slug }) {
  return readFileSync(path.join(docsRoot, `${slug}.mdx`), "utf8").replace(
    /^---\r?\n[\s\S]*?\r?\n---\r?\n/,
    "",
  );
}
