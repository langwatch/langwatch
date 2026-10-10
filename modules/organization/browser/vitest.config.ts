import { fileURLToPath } from "node:url";

import { defineModuleVitestConfig } from "@langwatch/vitest-config";
import { mergeConfig } from "vitest/config";

export default mergeConfig(
  // The module defaults compile through the React Compiler, as apps/ui ships them.
  defineModuleVitestConfig({
    kind: "jsdom",
    isolate: true,
    test: {
      setupFiles: ["./vitest.setup.ts"],
      // A Chakra overlay under a loaded worker pool is slow, not broken.
      testTimeout: 30_000,
    },
  }),
  {
    resolve: {
      alias: {
        "@langwatch/organization-contract": fileURLToPath(
          new URL("../contract/src/index.ts", import.meta.url),
        ),
      },
    },
  },
);
