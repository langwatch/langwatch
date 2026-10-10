import { fileURLToPath } from "node:url";

import { defineModuleVitestConfig } from "@langwatch/vitest-config";
import { mergeConfig } from "vitest/config";

export default mergeConfig(
  defineModuleVitestConfig({
    kind: "jsdom",
    test: {
      setupFiles: ["./vitest.setup.ts"],
      testTimeout: 30_000,
    },
  }),
  {
    resolve: {
      alias: {
        "@langwatch/topic-contract": fileURLToPath(
          new URL("../contract/src/index.ts", import.meta.url),
        ),
      },
    },
  },
);
