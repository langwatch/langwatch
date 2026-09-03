/**
 * What the two handoff screens are mounted inside: the host port only. They
 * share `@langwatch/api-key-web`'s tRPC Provider with the API Keys settings
 * screen rather than binding a second instance over one cache.
 */

import {
  AuthorizeHostProvider,
  type AuthorizeHostPort,
  type AuthorizeSessionStatus,
} from "@langwatch/api-key-web/screens/authorize";
import { apiKeyApi } from "@langwatch/api-key-web/screens/api-key";
import { useMemo, type ReactNode } from "react";
import { useUiAddress } from "../../../../behavior/ui-address";
import { writeUiClipboard } from "../../../../behavior/ui-clipboard";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { uiLeaveTo } from "../../../../behavior/ui-departure";
import { authorizeUiMcpClient } from "../../../../behavior/ui-mcp-authorize";
import { UiProjectSwitcher } from "../../../chrome";
import { copyProjectApiKeyToClipboard } from "../../behavior/authorize-copy-to-clipboard";

/**
 * The organization graph, as narrow as these two screens read it: the active
 * project's name for the header, and its LEGACY base key for the one field that
 * renders one.
 */
type OrganizationGraphEntry = {
  id: string;
  teams: Array<{
    projects: Array<{ id: string; name: string; apiKey?: string | null }>;
  }>;
};

/** The address without its query string or fragment. */
function pathnameOf(address: string): string {
  const cut = address.search(/[?#]/);
  return cut === -1 ? address : address.slice(0, cut);
}

export function AuthorizeHost({ children }: { children: ReactNode }) {
  const { session, route, feedback, navigation } = useUiCapabilities();
  const activeScope = session.activeScope();
  const address = useUiAddress();

  const organizations = apiKeyApi.organization.getAll.useQuery({ isDemo: false });
  const graph = organizations.data as OrganizationGraphEntry[] | undefined;

  const activeProject = useMemo(() => {
    if (!activeScope.projectId) return void 0;
    for (const entry of graph ?? []) {
      for (const team of entry.teams) {
        const project = team.projects.find((candidate) => candidate.id === activeScope.projectId);
        if (project) return project;
      }
    }
    return void 0;
  }, [graph, activeScope.projectId]);

  const actor = session.currentUser();

  /**
   * Three states from two answers, order matters: reading "not signed in"
   * one render too early would round-trip a signed-in reader through the
   * front door. `isSettled()` gates it.
   */
  const sessionStatus: AuthorizeSessionStatus = actor
    ? "authenticated"
    : session.isSettled()
      ? "unauthenticated"
      : "loading";

  const reading = route.reading();

  const host = useMemo<AuthorizeHostPort>(
    () => ({
      scope: () => ({
        projectId: activeScope.projectId ?? void 0,
        projectName: activeProject?.name,
      }),
      sessionStatus: () => sessionStatus,
      route: () => ({ pathname: pathnameOf(address), query: reading.query }),
      navigate: (to) => navigation.navigate(to),
      replace: (to) => navigation.replace(to),
      handOffTo: (url) => uiLeaveTo(url),
      // An empty string is what the server sends a reader who may not hold the
      // key; it is an absence rather than a key, and the screen renders it as one.
      revealProjectApiKey: () => activeProject?.apiKey || void 0,
      // The block the chrome route publishes for exactly this: a screen that
      // needs the switcher in its OWN header rather than in the top bar.
      projectSwitcher: () => <UiProjectSwitcher />,
      authorizeMcpClient: (request) => authorizeUiMcpClient(request),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
      copyToClipboard: ({ text, succeeded }) =>
        copyProjectApiKeyToClipboard({
          text,
          succeeded,
          writeClipboard: writeUiClipboard,
          onSucceeded: (notice) => feedback.succeeded(notice),
          onFailed: (failure) => feedback.failed(failure),
        }),
    }),
    [activeScope.projectId, activeProject, sessionStatus, address, reading, navigation, feedback],
  );

  return <AuthorizeHostProvider value={host}>{children}</AuthorizeHostProvider>;
}
