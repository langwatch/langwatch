/**
 * Which page key the Agents address answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN. The key still reads
 * `runtime/ui/features/agent-ui-host.adapter`, and it is kept rather than
 * renamed: the route transcript in `apps/ui/tests/fixtures` is the parity bar
 * for the URL surface and fails the moment a page key changes, so renaming one
 * would spend that guard's signal on a cosmetic edit. Every family before this
 * one left its keys alone for the same reason, and several of them name platform
 * modules that no longer exist either.
 *
 * The page is wrapped twice, and the order matters. The host provider is
 * OUTSIDE the guard: a refusal renders the guard's own fallback, which asks
 * nothing of the Agents host, but a page that opens needs the host mounted above
 * it before its first render. Inside that, the guard states the policy the
 * platform higher-order component carried.
 *
 * THE POLICY IS THE PLATFORM PAGE'S, ONE FOR ONE: `withPermissionGuard`
 * ("evaluations:view") and no flag. `layoutComponent: DashboardLayout` was the
 * other half of that call and does not travel — chrome belongs to the route
 * tree, and this page is a child of a layout route the composing application
 * still serves.
 *
 * The wrapping happens once per lazy load rather than once per render: React
 * Router caches what a `lazy` resolves to, so the component identity below is
 * stable for the life of the route.
 */

import { agentScreens } from "@langwatch/agent-web/screens/agent-management";
import type { ComponentType } from "react";
import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { AGENT_PAGE_PERMISSION } from "../../behavior/agent-host.adapter";
import { withAgentHost } from "./agent-host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

const agentManagementPage: UiPageLoader = async () => {
  const module = await agentScreens.agentManagement();
  const guarded = withUiPageGuard({
    permission: AGENT_PAGE_PERMISSION,
    fallbacks: FALLBACKS,
  })(module.default as ComponentType);
  return { default: withAgentHost(guarded) };
};

export const agentPageLoaders: UiPageLoaderRegistry = {
  "runtime/ui/features/agent-ui-host.adapter": agentManagementPage,
};
