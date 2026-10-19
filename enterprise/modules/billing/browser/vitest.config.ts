import { fileURLToPath } from "node:url";

import { defineModuleVitestConfig } from "@langwatch/vitest-config";
import { mergeConfig } from "vitest/config";

export default mergeConfig(
  defineModuleVitestConfig({
    kind: "jsdom",
    // Suites mock their own behavior modules; a shared fork would hand them the real one.
    isolate: true,
    test: { environment: "node", setupFiles: ["./src/__tests__/setup.ts"] },
  }),
  {
    resolve: {
      alias: {
        "@langwatch/enterprise-billing-contract": fileURLToPath(
          new URL("../contract/src/index.ts", import.meta.url),
        ),
        "@langwatch/enterprise-licensing-contract": fileURLToPath(
          new URL("../../licensing/contract/src/index.ts", import.meta.url),
        ),
      },
    },
  },
);
