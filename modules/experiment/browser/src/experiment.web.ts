/**
 * What a browser installs when it installs experiment: the drawers the
 * address bar opens (`?drawer.open=<name>`), under the names the product
 * has always used.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const experimentWeb = defineWebModule("experiment")
  .withScreens({
    "pages/[project]/experiments/index": {
      load: () => import("./ui/sections/experiments/experiments.screen.tsx"),
    },
    "pages/[project]/experiments/workbench/index": {
      load: () => import("./ui/sections/experiments/new-workbench.screen.tsx"),
    },
    "pages/[project]/experiments/workbench/[slug]": {
      load: () => import("./ui/sections/experiments/workbench.screen.tsx"),
    },
    "pages/[project]/experiments/[experiment]": {
      load: () => import("./ui/sections/experiments/experiment-detail.screen.tsx"),
    },
    /** The retired evaluation wizard forwards into the workbench. */
    "pages/[project]/evaluations/wizard/[slug]": {
      load: () => import("./ui/sections/experiments/evaluation-wizard-redirect.screen.tsx"),
    },
  })
  .withDrawers({
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
