import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "jsdom",
  test: {
    setupFiles: ["./vitest.setup.ts"],
    css: { include: [/langy-theme\.css/] },
  },
});
