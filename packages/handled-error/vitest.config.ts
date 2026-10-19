import { configDefaults, defineConfig } from "vitest/config";

import { repoScans } from "./vitest.repo.config.ts";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ...repoScans],
  },
});
