/** Real-Chromium lane: the plan card measured spacing and colours, which jsdom reports as zero. */

import { fileURLToPath } from "node:url";

import { defineBrowserVitestConfig } from "@langwatch/vitest-config/browser";
import { mergeConfig } from "vitest/config";

export default mergeConfig(defineBrowserVitestConfig(), {
  resolve: {
    alias: {
      "@langwatch/enterprise-billing-contract": fileURLToPath(
        new URL("../contract/src/index.ts", import.meta.url),
      ),
    },
  },
});
