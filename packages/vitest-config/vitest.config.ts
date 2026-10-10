// This package builds the shape, so it declares its own by relative path:
// the import stays inside the package and needs no dependency on itself.
import { defineModuleVitestConfig } from "./src/vitest-config.ts";

export default defineModuleVitestConfig({ kind: "unit" });
