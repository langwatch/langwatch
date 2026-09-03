import { configDefaults } from "vitest/config";

export default {
  test: {
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
  },
};
