/**
 * What a browser installs when it installs experiment: the drawers the
 * address bar opens (`?drawer.open=<name>`), under the names the product
 * has always used.
 */

import { agentTrpc } from "@langwatch/agent-contract";
import { defineBrowserModule } from "@langwatch/browser";
import { batchRecordTrpc, datasetRecordTrpc, datasetTrpc } from "@langwatch/dataset-contract";
import { evaluationTrpc } from "@langwatch/evaluation-contract";
import { evaluatorTrpc } from "@langwatch/evaluator-contract";
import { experimentsTrpc } from "@langwatch/experiment-contract";
import { opsDashboardTrpc } from "@langwatch/ops-contract";
import { promptTrpc } from "@langwatch/prompt-contract";

import { experimentApi } from "./behavior/experiment-api.ts";

export const experimentWeb = defineBrowserModule("experiment")
  .withApi(experimentApi, {
    contracts: [
      experimentsTrpc,
      agentTrpc,
      promptTrpc,
      evaluatorTrpc,
      evaluationTrpc,
      datasetTrpc,
      datasetRecordTrpc,
      batchRecordTrpc,
      opsDashboardTrpc,
    ],
  })
  // The replicate dialog reads workflow's port; workflow mounts it.
  .withHosts({ requires: ["WorkflowHostApi"] })
  .withScreens({
    "pages/[project]/experiments/index": {
      requires: "experiments:view",
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
  })
  /** The comparison evaluator form, lent to the evaluator editor (§3.4 rule 7). */
  .withCapabilities({
    comparisonConfigForm: {
      load: async () => ({
        default: (
          await import("./ui/sections/experiments-v3/EvaluatorPanel/comparison-config-form.tsx")
        ).ComparisonConfigForm,
      }),
    },
  });
