/**
 * Enables Node's on-disk compile cache (`module.enableCompileCache`, Node
 * ≥22.1) as the FIRST side effect of the CLI boot.
 *
 * Every cold start re-compiles the modules the boot path pulls in — commander
 * alone is ~10ms of compile on the in-process path. The compile cache stores
 * V8's bytecode under `$TMPDIR/node-compile-cache/<node-version>-<arch>-<hash>/`
 * and reuses it on subsequent runs, which is the same trick npm's own bin
 * uses. The 600KB tsup bundle itself is compiled
 * before any of our code can run, so this only helps what loads after it —
 * which is exactly commander, chalk (when needed) and dotenv.
 *
 * Guarded rather than assumed: the package's engines floor is Node 20 (no
 * such API), Bun's `node:module` does not implement it either, and a cache
 * write failure must never cost the user their CLI. Worst case in every one
 * of those paths is "no cache", i.e. exactly the behaviour before this
 * module existed.
 */
import module from "node:module";

try {
  module.enableCompileCache?.();
} catch {
  // A compile cache is an optimisation, never a reason to fail a boot.
}
