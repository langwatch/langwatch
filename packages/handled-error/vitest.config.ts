import { configDefaults, defineConfig } from "vitest/config";

import { repoScans } from "./vitest.repo.config.ts";

export default defineConfig({
  test: {
    fsModuleCache: true,
    exclude: [...configDefaults.exclude, ...repoScans],
  },
});
