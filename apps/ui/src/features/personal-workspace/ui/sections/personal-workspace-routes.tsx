/**
 * Which page key each personal-workspace screen answers, and what it is
 * wrapped in.
 *
 * The route table names eight page keys — five under `/me`, two under a project
 * and Settings > Authentication — and the package exposes loaders under names
 * of its own. This is the map between them, and the only place either
 * vocabulary meets the other. `/me/devices` is not here: it is a redirect row
 * in the table, which is what a path that only ever went somewhere else should
 * be.
 *
 * THE POLICY IS THE PLATFORM PAGES', ONE FOR ONE. All seven personal keys were
 * behind `withFeatureFlagGuard("release_ui_ai_governance_enabled")` and none of them
 * carried a permission guard, so that is what is stated here. The five `/me`
 * pages passed `bypassOnboardingRedirect: true`, which was never a refusal — it
 * turned OFF the platform guard's habit of bouncing a reader with no project to
 * onboarding. Landing policy did not travel with the family (the gateway family
 * made the same cut), so there is nothing left to bypass and no flag for it.
 *
 * SETTINGS > AUTHENTICATION IS WRAPPED DIFFERENTLY from the other seven, in all
 * three of the ways that can differ, and each is the platform page's policy one
 * for one: NO FLAG (it shipped long before the AI Governance flag existed and
 * every signed-in reader has always been able to open it), NO PERMISSION
 * (everything on it is keyed on the reader's own account), and SETTINGS CHROME
 * rather than a personal-home marker (it is reached from the settings
 * navigation, and a reader who opens it has not chosen the personal workspace
 * as their home).
 */

import {
  personalWorkspaceScreens,
  type PersonalWorkspaceScreenName,
} from "@langwatch/user-web/screens/personal-workspace";
import { useEffect, type ComponentType } from "react";
import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { uiPage } from "../../../../ui/sections/ui-page";
import { PersonalWorkspaceHost } from "./personal-workspace-host";

/**
 * The one flag every `/me` and project-scoped page in this family is behind.
 * It is the governance section's flag rather than a personal one: the personal
 * workspace shipped as part of AI Governance and the whole family releases
 * with it.
 */
const PERSONAL_WORKSPACE_FLAG = "release_ui_ai_governance_enabled";

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

/** The seven `/me` and project-scoped pages: flagged, no permission, no chrome. */
function personalWorkspacePage(screen: PersonalWorkspaceScreenName, { title }: { title: string }) {
  return uiPage({
    screen: async () => ({
      default: withDocumentTitle(
        title,
        (await personalWorkspaceScreens[screen]()).default as ComponentType,
      ),
    }),
    host: PersonalWorkspaceHost,
    flags: [PERSONAL_WORKSPACE_FLAG],
  });
}

export const personalWorkspacePageLoaders: UiPageLoaderRegistry = {
  "pages/settings/authentication": uiPage({
    screen: async () => ({
      default: withDocumentTitle(
        "Authentication · LangWatch",
        (await personalWorkspaceScreens.authentication()).default as ComponentType,
      ),
    }),
    host: PersonalWorkspaceHost,
    settingsLayout: true,
  }),
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
  }),
  "pages/[project]/pull-requests": personalWorkspacePage("projectPullRequests", {
    title: "Pull requests · LangWatch",
  }),
};
