/**
 * Which page keys the Workflows addresses answer, and what they are wrapped in.
 *
 * TWO KEYS, TWO SCREENS, and the keys are kept rather than renamed: the route
 * transcript in `apps/ui/tests/fixtures` is the parity bar for the URL surface
 * and fails the moment a page key changes. Every family before this one left
 * its keys alone for the same reason.
 *
 * THE THIRD KEY LANDED. `pages/[project]/studio/[workflow]` was recorded as
 * blocked on a copy set of 220 platform modules; the deletes-only ruling turned
 * every one of those copies into a move, and the studio now answers out of
 * `@langwatch/workflow-web/screens/studio`. The route table is unchanged, so a
 * reader moving between the list and the studio never learns which half of the
 * product served which page.
 *
 * THE POLICIES DIFFER AND THEY ARE THE PLATFORM PAGES', ONE FOR ONE. The list
 * page was `withPermissionGuard("workflows:view")`; the studio page and the chat
 * page were not
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

import { studioScreens } from "@langwatch/workflow-web/screens/studio";
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

/**
 * The studio carries NO page guard, which is the platform page's own policy:
 * `pages/[project]/studio/[workflow]` was never wrapped, and a workflow the
 * reader cannot open is refused by `workflow.getById` rather than by the route.
 */
const workflowStudioPage: UiPageLoader = async () => {
  const module = await studioScreens.studio();
  const guarded = withUiPageGuard({ fallbacks: FALLBACKS })(module.default as ComponentType);
  guarded.displayName = "WorkflowStudioPage";
  return { default: withWorkflowHost(guarded) };
};

export const workflowPageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/workflows": workflowsListPage,
  "pages/[project]/chat/[workflow]": workflowChatPage,
  "pages/[project]/studio/[workflow]": workflowStudioPage,
};
