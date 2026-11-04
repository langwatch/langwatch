import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { readBuildIndex } from "../checks/build-index.ts";

/** A page as the build writes it: canonical address and heading ids. */
export function page({
  slug,
  ids = [],
  body = "",
}: {
  slug: string;
  ids?: string[];
  body?: string;
}) {
  const headings = ids.map((id) => `<h2 id="${id}">${id}</h2>`).join("");
  return `<!doctype html><html><head><link rel="canonical" href="https://langwatch.ai/docs/${slug}"></head><body>${headings}${body}</body></html>`;
}

export const REDIRECT_PAGE =
  '<!doctype html><html><head><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=/x"></head></html>';

/** A throwaway build directory holding `files`; `redirects.json` defaults to none. */
export function buildFixture({ files }: { files: Record<string, string> }) {
  const outDir = mkdtempSync(path.join(os.tmpdir(), "docs-links-"));
  for (const [name, content] of Object.entries({ "redirects.json": "{}", ...files })) {
    const file = path.join(outDir, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return {
    outDir,
    index: ({ basePath = "" }: { basePath?: string } = {}) => readBuildIndex({ outDir, basePath }),
    dispose: () => rmSync(outDir, { recursive: true, force: true }),
  };
}
