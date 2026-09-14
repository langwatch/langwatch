/**
 * Which page key each personal-workspace screen answers. Seven keys share
 * one flag and no permission guard; Settings > Authentication differs in
 * all three ways that can differ — no flag, no permission, settings chrome.
 */

import {
  personalWorkspaceScreens,
  type PersonalWorkspaceScreenName,
} from "@langwatch/user-web/personal-workspace";
import { useEffect, type ComponentType } from "react";
import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { useUiCapabilities } from "@langwatch/ui-host/capabilities";
import { uiPage } from "../../../../ui/sections/ui-page";
import { PersonalWorkspaceHost } from "./personal-workspace-host";

/** Feature flag for personal workspace pages (AI Governance). */
const PERSONAL_WORKSPACE_FLAG = "release_ui_ai_governance_enabled";

/** Set the browser tab title via capability, restoring on unmount. */
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
