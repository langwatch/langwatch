/** Which page key the Agents address answers, and what it is wrapped in. */

import { agentScreens } from "@langwatch/agent-web/screens/agent-management";
import type { ComponentType } from "react";
import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { AgentHost } from "./agent-host";

/** The grant the platform page asked for, unchanged. */
const AGENT_PAGE_PERMISSION = "evaluations:view";

export const agentPageLoaders: UiPageLoaderRegistry = {
  // Key and permission unchanged from the platform page; layoutComponent
  // doesn't travel — chrome belongs to the route tree, not this page.
  "runtime/ui/features/agent-ui-host.adapter": uiPage({
    screen: async () => ({
      default: (await agentScreens.agentManagement()).default as ComponentType,
    }),
    host: AgentHost,
    permission: AGENT_PAGE_PERMISSION,
  }),
};
