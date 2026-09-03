/**
 * Which page key the Agents address answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN. The key still reads
 * `runtime/ui/features/agent-ui-host.adapter`, and it is kept rather than
 * renamed: the route transcript in `apps/ui/tests/fixtures` is the parity bar
 * for the URL surface and fails the moment a page key changes, so renaming one
 * would spend that guard's signal on a cosmetic edit.
 *
 * THE POLICY IS THE PLATFORM PAGE'S, ONE FOR ONE: `withPermissionGuard`
 * ("evaluations:view") and no flag. `layoutComponent: DashboardLayout` was the
 * other half of that call and does not travel — chrome belongs to the route
 * tree, and this page is a child of a layout route the composing application
 * still serves.
 */

import { agentScreens } from "@langwatch/agent-web/screens/agent-management";
import type { ComponentType } from "react";
import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { AgentHost } from "./agent-host";

/** The grant the platform page asked for, unchanged. */
const AGENT_PAGE_PERMISSION = "evaluations:view";

export const agentPageLoaders: UiPageLoaderRegistry = {
  "runtime/ui/features/agent-ui-host.adapter": uiPage({
    screen: async () => ({
      default: (await agentScreens.agentManagement()).default as ComponentType,
    }),
    host: AgentHost,
    permission: AGENT_PAGE_PERMISSION,
  }),
};
