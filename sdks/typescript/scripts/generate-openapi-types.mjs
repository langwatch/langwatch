import { execFileSync } from "node:child_process";
// Skips regenerating api-client.ts when a fingerprint of its two real
// inputs (the openapi document, the patch script) still matches the one
// recorded after the last run -- same inputs, deterministically same
// output. The stamp lives beside the generated file, gitignored like that
// whole directory, so a fresh checkout pays the ~1.6s round trip once.
// Gap: bumping the openapi-typescript version alone will not invalidate it.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const docPath = join(packageRoot, "../../specs/api-reference/openapi-document.json");
const outPath = join(packageRoot, "src/internal/generated/openapi/api-client.ts");
const patchScriptPath = join(packageRoot, "scripts/patch-generated-openapi.mjs");
const stampPath = join(packageRoot, "src/internal/generated/openapi/.fingerprint");

if (!existsSync(docPath)) {
  console.error(`${docPath} is missing; the SDK client types are generated from it`);
  process.exit(1);
}

const fingerprint = createHash("sha256")
  .update(readFileSync(docPath))
  .update(readFileSync(patchScriptPath))
  .digest("hex");

const stamped = existsSync(stampPath) ? readFileSync(stampPath, "utf8").trim() : null;
if (stamped === fingerprint && existsSync(outPath)) {
  process.exit(0);
}

execFileSync("pnpm", ["exec", "openapi-typescript", docPath, "-o", outPath], {
  cwd: packageRoot,
  stdio: "inherit",
});
execFileSync("node", [patchScriptPath], { cwd: packageRoot, stdio: "inherit" });
writeFileSync(stampPath, `${fingerprint}\n`);
