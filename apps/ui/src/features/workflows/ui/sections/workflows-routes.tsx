/**
 * Which page keys the Workflows addresses answer, and what they are wrapped in.
 *
 * TWO KEYS, TWO SCREENS, and the keys are kept rather than renamed: the route
 * transcript in `apps/ui/tests/fixtures` is the parity bar for the URL surface
 * and fails the moment a page key changes. Every family before this one left
 * its keys alone for the same reason.
 *
 * THE THIRD KEY IS NOT HERE. `pages/[project]/studio/[workflow]` is still
 * served by `platform/app`, and it is blocked on the size of its copy set
 * rather than on ownership — the numbers are in
 * `dev/docs/plans/ui-family-move-manifests.md` and restated in the package's
 * screen entry. The route table is unchanged either way, so a reader moving
 * between the list and the studio never learns which half of the product served
 * which page.
 *
 * THE POLICIES DIFFER AND THEY ARE THE PLATFORM PAGES', ONE FOR ONE. The list
 * page was `withPermissionGuard("workflows:view")`; the chat page was not
 * wrapped at all, which is what a shared link to a published workflow's chat
 * has always done. `layoutComponent: DashboardLayout` was the other half of the
 * list page's call and does not travel — chrome belongs to the route tree, and
 * the list page is a child of a layout route the composing application still
 * serves. The chat page never had chrome at all.
 *
 * The wrapping happens once per lazy load rather than once per render: React
 * Router caches what a `lazy` resolves to, so the component identity below is
 * stable for the life of the route.
 */

import { workflowScreens } from "@langwatch/workflow-web/screens/workflows";
import type { ComponentType } from "react";

import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { WORKFLOWS_PAGE_PERMISSION } from "../../behavior/workflows-host.adapter";
import { withWorkflowHost } from "./workflows-host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

const workflowsListPage: UiPageLoader = async () => {
  const module = await workflowScreens.workflows();
  const guarded = withUiPageGuard({
    permission: WORKFLOWS_PAGE_PERMISSION,
    fallbacks: FALLBACKS,
  })(module.default as ComponentType);
  guarded.displayName = "WorkflowsPage";
  return { default: withWorkflowHost(guarded) };
};

const workflowChatPage: UiPageLoader = async () => {
  const module = await workflowScreens.workflowChat();
  const guarded = withUiPageGuard({ fallbacks: FALLBACKS })(module.default as ComponentType);
  guarded.displayName = "WorkflowChatPage";
  return { default: withWorkflowHost(guarded) };
};

export const workflowPageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/workflows": workflowsListPage,
  "pages/[project]/chat/[workflow]": workflowChatPage,
};
