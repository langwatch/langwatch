import { fileURLToPath } from "node:url";

import { defineModuleVitestConfig } from "@langwatch/vitest-config";
import { mergeConfig } from "vitest/config";

export default mergeConfig(
  defineModuleVitestConfig({
    kind: "jsdom",
    test: {
      setupFiles: ["./vitest.setup.ts"],
      // One screen, three dialogs driven through real user events. The same
      // budget every other feature-web package took, for the same reason: a
      // Chakra overlay under a loaded worker pool is slow, not broken.
      testTimeout: 30_000,
    },
  }),
  {
    resolve: {
      alias: {
        "@langwatch/secret-contract": fileURLToPath(
          new URL("../contract/src/index.ts", import.meta.url),
        ),
      },
    },
  },
);
