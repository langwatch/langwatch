/**
 * Enables Node's on-disk compile cache (Node >=22.1) as the FIRST boot side
 * effect, reusing V8 bytecode on later runs. Guarded, not assumed: Node 20
 * and Bun's `node:module` lack the API, so failure degrades to "no cache."
 */
import module from "node:module";

try {
  module.enableCompileCache?.();
} catch {
  // A compile cache is an optimisation, never a reason to fail a boot.
  void 0;
}
