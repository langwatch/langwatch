import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "jsdom",
  isolate: false,
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"] },
});
