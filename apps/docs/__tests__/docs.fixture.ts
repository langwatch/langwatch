import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function docsFixture({
  config,
  pages = {},
  main = { paths: {} },
  evals = { paths: {} },
}: {
  config: unknown;
  pages?: Record<string, string>;
  main?: unknown;
  evals?: unknown;
}) {
  const docsRoot = mkdtempSync(path.join(os.tmpdir(), "docs-generator-"));
  const sources = {
    "docs.json": JSON.stringify(config),
    "api-reference/openapiLangWatch.json": JSON.stringify(main),
    "api-reference/openapi-evals.json": JSON.stringify(evals),
    ...pages,
  };
  for (const [name, source] of Object.entries(sources)) {
    const file = path.join(docsRoot, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  return { docsRoot, dispose: () => rmSync(docsRoot, { recursive: true, force: true }) };
}
