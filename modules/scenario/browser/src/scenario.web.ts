/**
 * What a browser installs when it installs scenario: Agent Testing, the
 * scenario library and the simulations pages, plus the drawers the address
 * bar opens (`?drawer.open=<name>`) under the names the product already uses.
 */

import { defineBrowserModule } from "@langwatch/browser";
import {
  MediaPartToken,
  ParameterLineFieldToken,
  TalkToItPanelToken,
} from "@langwatch/scenario-contract";

export const scenarioWeb = defineBrowserModule("scenario")
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
    agentTestingSuiteEditor: {
      load: async () => ({
        default: (await import("./ui/sections/agent-testing/drawers/suite-editor-drawer.tsx"))
          .SuiteEditorDrawer,
      }),
    },
  })
  /** The media renderer, lent to trace by token (§10.1). */
  .lends(MediaPartToken, {
    load: async () => ({
      default: (await import("./ui/sections/media-part.tsx")).MediaPart,
    }),
  })
  /** The call panel and parameter line lent to agent by token (§10.1). */
  .lends(ParameterLineFieldToken, {
    load: async () => ({
      default: (await import("./ui/sections/agent-testing/run/lent-parameter-line-field.tsx"))
        .LentParameterLineField,
    }),
  })
  .lends(TalkToItPanelToken, {
    load: async () => ({
      default: (await import("./features/talk-to-it/ui/sections/wired-talk-to-it-panel.tsx"))
        .LentTalkToItPanel,
    }),
  });
