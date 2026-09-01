/**
 * Which page key each personal-workspace screen answers, and what it is
 * wrapped in.
 *
 * The route table names seven page keys — five under `/me` and two under a
 * project — and the package exposes seven loaders under names of its own. This
 * is the map between them, and the only place either vocabulary meets the
 * other. `/me/devices` is not here: it is a redirect row in the table, which is
 * what a path that only ever went somewhere else should be.
 *
 * Each page is wrapped three times, and the order matters. The host provider is
 * OUTSIDE the guard: a refusal renders the guard's own fallback, which asks
 * nothing of the personal-workspace host, but a page that opens needs the host
 * mounted above it before its first render. Inside that, the guard states the
 * policy the platform higher-order component carried. Innermost, the title: it
 * is set by a page that actually opened, never by one that turned out to be a
 * 404.
 *
 * THE POLICY IS THE PLATFORM PAGES', ONE FOR ONE. All seven were behind
 * `withFeatureFlagGuard("release_ui_ai_governance_enabled")` and none of them
 * carried a permission guard, so that is what is stated here. The five `/me`
 * pages passed `bypassOnboardingRedirect: true`, which was never a refusal — it
 * turned OFF the platform guard's habit of bouncing a reader with no project to
 * onboarding. Landing policy did not travel with the family (the gateway family
 * made the same cut), so there is nothing left to bypass and no flag for it.
 *
 * The wrapping happens once per lazy load rather than once per render: React
 * Router caches what a `lazy` resolves to, so the component identity below is
 * stable for the life of the route.
 */

import {
  personalWorkspaceScreens,
  type PersonalWorkspaceScreenName,
} from "@langwatch/user-web/screens/personal-workspace";
import { useEffect, type ComponentType } from "react";
import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { useRememberPersonalHome } from "../../../../behavior/ui-home-kind";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { withPersonalWorkspaceHost } from "./personal-workspace-host-provider";

/**
 * The one flag every page in this family is behind. It is the governance
 * section's flag rather than a personal one: the personal workspace shipped as
 * part of AI Governance and the whole family releases with it.
 */
const PERSONAL_WORKSPACE_FLAG = "release_ui_ai_governance_enabled";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

/**
 * The browser tab's title, set by the page that owns it.
 *
 * `platform/app` set it with a `<Head><title>` inside each page body, which is
 * the application's compatibility shim for a framework this application does
 * not run. A screen may not reach the document, so the title travels as data
 * and the document-title capability writes it — and puts the previous one back
 * when the page unmounts, which is what keeps a title from outliving its page.
 */
function withDocumentTitle<P extends object>(
  title: string,
  Page: ComponentType<P>,
): ComponentType<P> {
  const Titled = (props: P) => {
    const { documentTitle } = useUiCapabilities();
    useEffect(() => documentTitle.set(title), [documentTitle]);
    return <Page {...props} />;
  };
  Titled.displayName = `withDocumentTitle(${Page.displayName ?? Page.name ?? "Page"})`;
  return Titled;
}

/**
 * Marks the personal workspace as the last home this reader opened.
 *
 * `MyLayout` did this on every `/me/*` page and no others, so the marker rides
 * the five personal keys and neither project one — a reader on
 * `/:project/sessions` is on a project page, and the resolution layer already
 * leaves `"project"` behind for it.
 */
function withPersonalHomeMarker<P extends object>(Page: ComponentType<P>): ComponentType<P> {
  const Marked = (props: P) => {
    useRememberPersonalHome();
    return <Page {...props} />;
  };
  Marked.displayName = `withPersonalHomeMarker(${Page.displayName ?? Page.name ?? "Page"})`;
  return Marked;
}

function personalWorkspacePage(
  screen: PersonalWorkspaceScreenName,
  { title, isPersonalHome = true }: { title: string; isPersonalHome?: boolean },
): UiPageLoader {
  return async () => {
    const module = await personalWorkspaceScreens[screen]();
    const titled = withDocumentTitle(title, module.default as ComponentType);
    const marked = isPersonalHome ? withPersonalHomeMarker(titled) : titled;
    const guarded = withUiPageGuard({ flags: [PERSONAL_WORKSPACE_FLAG], fallbacks: FALLBACKS })(
      marked,
    );
    return { default: withPersonalWorkspaceHost(guarded) };
  };
}

export const personalWorkspacePageLoaders: UiPageLoaderRegistry = {
  "pages/me/index": personalWorkspacePage("overview", { title: "My Usage · LangWatch" }),
  "pages/me/configure": personalWorkspacePage("configure", {
    title: "My Settings · LangWatch",
  }),
  "pages/me/sessions": personalWorkspacePage("sessions", {
    title: "My Sessions · LangWatch",
  }),
  "pages/me/pull-requests": personalWorkspacePage("pullRequests", {
    title: "My Pull Requests · LangWatch",
  }),
  "pages/me/budget/request": personalWorkspacePage("budgetRequest", {
    title: "Request budget increase · LangWatch",
  }),
  "pages/[project]/sessions": personalWorkspacePage("projectSessions", {
    title: "Sessions · LangWatch",
    isPersonalHome: false,
  }),
  "pages/[project]/pull-requests": personalWorkspacePage("projectPullRequests", {
    title: "Pull requests · LangWatch",
    isPersonalHome: false,
  }),
};
