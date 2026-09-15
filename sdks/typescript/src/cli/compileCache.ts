/**
 * Enables Node's on-disk compile cache (`module.enableCompileCache`, Node ≥22.1)
 * as the FIRST side effect of the CLI boot, so commander/chalk/dotenv reuse V8
 * bytecode on later runs instead of recompiling (~10ms) each cold start.
 * Guarded rather than assumed: the package floor is Node 20 (no such API) and
 * Bun's `node:module` doesn't implement it either, so a failure must degrade
 * to "no cache," never cost the user their CLI.
 */
import module from "node:module";

try {
  module.enableCompileCache?.();
} catch {
  // A compile cache is an optimisation, never a reason to fail a boot.
}
