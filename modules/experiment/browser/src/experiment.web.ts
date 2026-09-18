/**
 * What a browser installs when it installs experiment: the drawers the
 * address bar opens (`?drawer.open=<name>`), under the names the product
 * has always used.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const experimentWeb = defineWebModule("experiment").withDrawers({
  comparisonLeaderboard: {
    load: async () => ({
      default: (await import("./ui/sections/batch-results/comparison-leaderboard-drawer.tsx"))
        .ComparisonLeaderboardDrawer,
    }),
  },
  targetTypeSelector: {
    load: async () => ({
      default: (await import("./ui/sections/experiments-v3/target-type-selector-drawer.tsx"))
        .TargetTypeSelectorDrawer,
    }),
  },
});
