import { configDefaults, defineConfig } from "vitest/config";

import { repoScans } from "./vitest.repo.config.ts";

export default defineConfig({
  test: {
    // Persist transforms between runs, as the shared config does (testing-speed.md).
    fsModuleCache: true,
    exclude: [...configDefaults.exclude, ...repoScans],
  },
});
