/**
 * What the two handoff screens are mounted inside.
 *
 * One thing goes around `/authorize` and `/mcp/authorize`: the host port. They
 * declare no transport of their own — every read they make is the application's
 * — so the tRPC Provider mounted here is `@langwatch/api-key-web`'s, the SAME
 * instance the API Keys settings screen runs on. Binding it twice would give the
 * two halves of one package two providers over one cache; the api-key frontend
 * feature already installs it, so this feature only calls it.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the graph
 * is fetched once for the document, and the base key `/authorize` prints comes
 * back on that one read under the server's own `project:update` redaction.
 */

import {
  AuthorizeHostProvider,
  type AuthorizeSessionStatus,
} from "@langwatch/api-key-web/screens/authorize";
import { apiKeyApi } from "@langwatch/api-key-web/screens/api-key";
import { useMemo, type ComponentType, type ReactNode } from "react";
import { useUiAddress } from "../../../../behavior/ui-address";
import { writeUiClipboard } from "../../../../behavior/ui-clipboard";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { uiLeaveTo } from "../../../../behavior/ui-departure";
import { authorizeUiMcpClient } from "../../../../behavior/ui-mcp-authorize";
import { UiProjectSwitcher } from "../../../chrome";
import { UiAuthorizeHost } from "../../behavior/authorize-host.adapter";

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

function AuthorizeHost({ children }: { children: ReactNode }) {
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
   * Three states from two answers, and the order matters.
   *
   * `/mcp/authorize` bounces a reader with no session through sign-in carrying
   * the whole consent request; reading "not signed in" one render too early
   * would send a signed-in reader on a round trip through the front door and
   * back. `isSettled()` is false until the session answer has arrived.
   */
  const sessionStatus: AuthorizeSessionStatus = actor
    ? "authenticated"
    : session.isSettled()
      ? "unauthenticated"
      : "loading";

  const reading = route.reading();

  const host = useMemo(
    () =>
      UiAuthorizeHost.create(
        {
          scope: {
            projectId: activeScope.projectId ?? void 0,
            projectName: activeProject?.name,
          },
          sessionStatus,
          route: { pathname: pathnameOf(address), query: reading.query },
          projectApiKey: activeProject?.apiKey ?? void 0,
          // The block the chrome route publishes for exactly this: a screen that
          // needs the switcher in its OWN header rather than in the top bar.
          projectSwitcher: <UiProjectSwitcher />,
        },
        {
          navigate: (to) => navigation.navigate(to),
          replace: (to) => navigation.replace(to),
          leaveTo: uiLeaveTo,
          authorizeMcpClient: authorizeUiMcpClient,
          succeeded: (notice) => feedback.succeeded(notice),
          failed: (failure) => feedback.failed(failure),
          writeClipboard: writeUiClipboard,
        },
      ),
    [
      activeScope.projectId,
      activeProject,
      sessionStatus,
      address,
      reading,
      navigation,
      feedback,
    ],
  );

  return <AuthorizeHostProvider value={host}>{children}</AuthorizeHostProvider>;
}

/** Wraps a handoff screen in the host its package asks for. */
export function withAuthorizeHost<P extends object>(
  Screen: ComponentType<P>,
): ComponentType<P> {
  const Mounted = (props: P) => (
    <AuthorizeHost>
      <Screen {...props} />
    </AuthorizeHost>
  );
  Mounted.displayName = `withAuthorizeHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}
