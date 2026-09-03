/**
 * Three page keys, kept rather than renamed — the route transcript in
 * `apps/ui/tests/fixtures` is the parity bar for the URL surface. Only the
 * list page carries `workflows:view`; studio and chat carry no guard.
 */

import { studioScreens } from "@langwatch/workflow-web/screens/studio";
import { workflowScreens } from "@langwatch/workflow-web/screens/workflows";
import type { ComponentType } from "react";

import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { WorkflowHost } from "./workflows-host";

const WORKFLOWS_PAGE_PERMISSION = "workflows:view";

export const workflowPageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/workflows": uiPage({
    screen: async () => ({ default: (await workflowScreens.workflows()).default as ComponentType }),
    host: WorkflowHost,
    permission: WORKFLOWS_PAGE_PERMISSION,
  }),
  "pages/[project]/chat/[workflow]": uiPage({
    screen: async () => ({
      default: (await workflowScreens.workflowChat()).default as ComponentType,
    }),
    host: WorkflowHost,
  }),
  "pages/[project]/studio/[workflow]": uiPage({
    screen: async () => ({ default: (await studioScreens.studio()).default as ComponentType }),
    host: WorkflowHost,
  }),
};
