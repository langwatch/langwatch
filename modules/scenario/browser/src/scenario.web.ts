/**
 * What a browser installs when it installs scenario: Agent Testing, the
 * scenario library and the simulations pages, plus the drawers the address
 * bar opens (`?drawer.open=<name>`) under the names the product already uses.
 */

import { defineWebModule } from "@langwatch/browser";

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
      requires: "scenarios:view",
      load: () => import("./ui/sections/simulations/scenario-library.screen.tsx"),
    },
    "pages/[project]/simulations/[[...path]]": {
      requires: "scenarios:view",
      load: () => import("./ui/sections/simulations/simulations.screen.tsx"),
    },
  })
  .withDrawers({
    suiteEditor: {
      load: async () => ({
        default: (await import("./ui/sections/suites/suite-form-drawer.tsx")).SuiteFormDrawer,
      }),
    },
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
  })
  /** The call panel and parameter line lent to agent, the media renderer to trace (§3.4 rule 7). */
  .withCapabilities({
    mediaPart: {
      load: async () => ({
        default: (await import("./ui/sections/media-part.tsx")).MediaPart,
      }),
    },
    parameterLineField: {
      load: async () => ({
        default: (await import("./ui/sections/agent-testing/run/lent-parameter-line-field.tsx"))
          .LentParameterLineField,
      }),
    },
    talkToItPanel: {
      load: async () => ({
        default: (await import("./features/talk-to-it/ui/sections/wired-talk-to-it-panel.tsx"))
          .LentTalkToItPanel,
      }),
    },
  });
