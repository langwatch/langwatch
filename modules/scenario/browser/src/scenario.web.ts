/**
 * What a browser installs when it installs scenario: Agent Testing, the
 * scenario library and the simulations pages, plus the drawers the address
 * bar opens (`?drawer.open=<name>`) under the names the product already uses.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const scenarioWeb = defineWebModule("scenario")
  .withHosts({
    requires: ["ScenarioHostApi"],
    mounts: { ScenarioHostApi: { load: () => import("./behavior/scenario-host-mount.tsx") } },
  })
  .withScreens({
    "pages/[project]/agent-testing/[[...path]]": {
      load: () => import("./ui/sections/simulations/agent-testing.screen.tsx"),
    },
    "pages/[project]/simulations/scenarios/index": {
      load: () => import("./ui/sections/simulations/scenario-library.screen.tsx"),
    },
    "pages/[project]/simulations/[[...path]]": {
      load: () => import("./ui/sections/simulations/simulations.screen.tsx"),
    },
  })
  .withDrawers({
    scenarioEditor: {
      load: async () => ({
        default: (await import("./ui/sections/scenarios/scenario-form-drawer.tsx"))
          .ScenarioFormDrawerFromUrl,
      }),
    },
    scenarioRunDetail: {
      load: async () => ({
        default: (await import("./ui/sections/simulations/scenario-run-detail-drawer.tsx"))
          .ScenarioRunDetailDrawer,
      }),
    },
    scenarioVersionHistory: {
      load: async () => ({
        default: (
          await import("./ui/sections/agent-testing/drawers/scenario-version-history-drawer.tsx")
        ).ScenarioVersionHistoryDrawer,
      }),
    },
    agentTestingCaseEditor: {
      load: async () => ({
        default: (
          await import("./ui/sections/agent-testing/cases/agent-testing-case-editor-drawer.tsx")
        ).AgentTestingCaseEditorDrawer,
      }),
    },
  });
