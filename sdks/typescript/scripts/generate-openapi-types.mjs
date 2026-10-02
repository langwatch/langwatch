// Regenerates the committed REST client types (src/internal/generated/openapi/api-client.ts)
// from the OpenAPI document. The document is generated from the api's route declarations and
// never committed, so this writes it first. The SDK build does not run this: the client types
// are SDK source, and CI regenerates them and fails on a diff (the `openapi-clients` job).
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = join(packageRoot, "../..");
const docPath = join(repositoryRoot, "specs/api-reference/openapi-document.json");
const outPath = join(packageRoot, "src/internal/generated/openapi/api-client.ts");
const patchScriptPath = join(packageRoot, "scripts/patch-generated-openapi.mjs");

execFileSync("pnpm", ["--filter", "@langwatch/platform-api", "run", "openapi:generate"], {
  cwd: repositoryRoot,
  stdio: "inherit",
});
execFileSync("pnpm", ["exec", "openapi-typescript", docPath, "-o", outPath], {
  cwd: packageRoot,
  stdio: "inherit",
});
execFileSync("node", [patchScriptPath], { cwd: packageRoot, stdio: "inherit" });
