/**
 * Which page key the Prompt Studio address answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN. The key still reads `pages/[project]/prompts`, and it is
 * kept rather than renamed: the route transcript in `apps/ui/tests/fixtures` is
 * the parity bar for the URL surface and fails the moment a page key changes,
 * so renaming one would spend that guard's signal on a cosmetic edit. Every
 * family before this one left its keys alone for the same reason.
 *
 * The page is wrapped twice, and the order matters. The host provider is
 * OUTSIDE the guard: a refusal renders the guard's own fallback, which asks
 * nothing of the Prompt host, but a page that opens needs the host mounted
 * above it before its first render. Inside that, the guard states the policy
 * the platform higher-order component carried —
 * `withPermissionGuard("prompts:view")`, unchanged. Its
 * `layoutComponent: DashboardLayout` was the other half of that call and does
 * not travel: chrome belongs to the route tree, and this page is a child of a
 * layout route the composing application still serves.
 *
 * The wrapping happens once per lazy load rather than once per render: React
 * Router caches what a `lazy` resolves to, so the component identity below is
 * stable for the life of the route.
 */

import { promptScreens } from "@langwatch/prompt-web/screens/prompt-studio";
import type { ComponentType } from "react";
import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { PROMPT_PAGE_PERMISSION } from "../../behavior/prompt-host.adapter";
import { withPromptHost } from "./prompt-host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

const promptStudioPage: UiPageLoader = async () => {
  const module = await promptScreens.promptStudio();
  const guarded = withUiPageGuard({
    permission: PROMPT_PAGE_PERMISSION,
    fallbacks: FALLBACKS,
  })(module.default as ComponentType);
  return { default: withPromptHost(guarded) };
};

export const promptPageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/prompts": promptStudioPage,
};
