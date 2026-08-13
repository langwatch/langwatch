/**
 * Loads the seed's env files as a module side effect, before anything that
 * reads or validates process.env at import time.
 *
 * seed.ts imports src/utils/encryption, which imports src/env.mjs, which runs
 * the whole zod env schema while the module graph evaluates. Static imports
 * hoist above the entry's own statements, so a dotenv call written inside
 * seed.ts would run long after that validation had already thrown
 * ("NEXTAUTH_SECRET: Required", "API_TOKEN_JWT_SECRET: Required"). The seed
 * therefore died before its first query anywhere the shell does not already
 * export those variables — which is every haven `up`, since the seed child
 * inherits the launcher's environment plus haven's overlay and neither has ever
 * carried .env. It has to be its own module for exactly the reason
 * src/env-load.ts is.
 *
 * Precedence matches loadSeedEnv() in seed.ts: process env wins over
 * platform/app/.env, which wins over the layer above it. dotenv does not
 * overwrite a variable that is already set, so plain ordered loads give that
 * for free — and NOT passing `override` is load-bearing, not an omission:
 * haven hands the seed the per-slug DATABASE_URL of the stack it is bringing
 * up, and an overriding load would hand that back to whatever .env pins and
 * seed a different database than the one the stack runs on.
 *
 * Quiet on purpose: this is a one-shot lane whose own output is the summary,
 * and haven already silences dotenv's banner on every prep lane it runs.
 */
import dotenv from "dotenv";

// cwd is platform/app for every caller — haven, CI, and the pnpm script all
// invoke the seed there (same assumption loadSeedEnv documents).
for (const path of [".env", "../.env"]) {
  dotenv.config({ path, quiet: true });
}
