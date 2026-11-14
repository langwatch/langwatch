import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  // The legacy key suite replaces @langwatch/observability with vi.mock,
  // which a registry shared with earlier files has already loaded for real.
  isolate: true,
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
