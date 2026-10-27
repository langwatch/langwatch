// Regenerates the committed REST client types (src/internal/generated/openapi/api-client.ts)
// from the OpenAPI document. The document is generated from the api's route declarations and
// never committed, so this writes it first. The SDK build does not run this: the client types
// are SDK source, and CI regenerates them and fails on a diff (the `openapi-clients` job).
// Only the routes the SDK calls are generated: scripts/filter-openapi-document.mjs.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { filterDocumentForSource } from "./filter-openapi-document.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = join(packageRoot, "../..");
const docPath = join(repositoryRoot, "specs/api-reference/openapi-document.json");
const outPath = join(packageRoot, "src/internal/generated/openapi/api-client.ts");
const patchScriptPath = join(packageRoot, "scripts/patch-generated-openapi.mjs");

execFileSync("pnpm", ["--filter", "@langwatch/platform-api", "run", "openapi:generate"], {
  cwd: repositoryRoot,
  stdio: "inherit",
});
const filtered = filterDocumentForSource({
  document: JSON.parse(readFileSync(docPath, "utf8")),
  sourceDirectory: join(packageRoot, "src"),
  generatedDirectory: join(packageRoot, "src/internal/generated"),
});
const scratch = mkdtempSync(join(tmpdir(), "langwatch-sdk-openapi-"));
const filteredPath = join(scratch, "openapi-document.json");
writeFileSync(filteredPath, JSON.stringify(filtered));
try {
  execFileSync("pnpm", ["exec", "openapi-typescript", filteredPath, "-o", outPath], {
    cwd: packageRoot,
    stdio: "inherit",
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
execFileSync("node", [patchScriptPath], { cwd: packageRoot, stdio: "inherit" });
