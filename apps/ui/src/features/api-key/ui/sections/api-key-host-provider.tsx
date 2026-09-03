/**
 * What the two API Key screens are mounted inside.
 *
 * Two things go around `/settings/api-keys` and `/cli/auth`: the tRPC Provider
 * the package's own hooks run on, and the host port that answers for the scope,
 * the grants, the visible scopes, the organization graph, the session, the
 * address, the feedback, the clipboard, the lead-source stamp, the one platform
 * drawer and the three CLI device-flow calls — and nothing else. A screen stays
 * a screen module.
 *
 * The reads live here rather than in the adapter for a reason worth keeping: the
 * adapter is a value object over what has already been read, so a test
 * constructs one, while a hook cannot be constructed at all.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product want
 * it. Both screens read it, for different things — the settings page for the
 * scope filter's options and the legacy project key, the CLI page for the
 * project picker's ownership and slug facts.
 *
 * THE TEAM IS DERIVED, NOT ASKED, the same way the retention and model-provider
 * families derive it: `UiActiveScope` carries the organization and the project,
 * and the scope filter also needs the team the project belongs to. It is one
 * lookup in the graph already read.
 */

import {
  apiKeyApi,
  ApiKeyHostProvider,
  type ApiKeyAvailableScopes,
  type ApiKeyOrganization,
  type ApiKeySessionStatus,
} from "@langwatch/api-key-web/screens/api-key";
import { useMemo, type ComponentType, type ReactNode } from "react";
import { useUiAddress } from "../../../../behavior/ui-address";
import { writeUiClipboard } from "../../../../behavior/ui-clipboard";
import { browserUiSessionStorage } from "../../../../behavior/ui-browser-storage";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import {
  approveCliDeviceCode,
  denyCliDeviceCode,
  lookupCliDeviceCode,
} from "../../../../behavior/ui-cli-device-flow";
import { readPublicAppConfig } from "../../../../behavior/public-config";
import { UiApiKeyHost } from "../../behavior/api-key-host.adapter";

/**
 * Where the API a minted key will be used against lives.
 *
 * A composition whose HTML shell carries no configuration is a self-hosted one
 * with no stated base URL rather than a broken one: the snippets then name the
 * cloud endpoint, which is the same default `build-mcp-config` has always used.
 * The governance family reads the same fact the same way.
 */
function readApiEndpoint(): string {
  try {
    return readPublicAppConfig().appBaseUrl;
  } catch {
    return "https://app.langwatch.ai";
  }
}

/**
 * The `#...` part of the address, without the hash.
 *
 * `UiRoutePort` answers params and query and carries no fragment, and a screen
 * may not read `window.location` — so the whole address comes from the global
 * layer's `useUiAddress`, which is the seam that keeps `react-router` out of a
 * feature. A trace's API-key attribute deep-links to `#api-key-<id>`, and the
 * settings screen re-does the scroll once its rows exist.
 */
function fragmentOf(address: string): string {
  const hash = address.indexOf("#");
  return hash === -1 ? "" : address.slice(hash + 1);
}

/**
 * The organization graph, as narrow as the two screens read it.
 *
 * `organization.getAll` answers a wide server row; what is named here is the
 * subset the package's own port declares, plus the two fields the API Keys table
 * needs off the active project — its name for the scope chip and its LEGACY
 * base key for the one row that renders one.
 */
type OrganizationGraphEntry = {
  id: string;
  name: string;
  teams: Array<{
    id: string;
    name: string;
    isPersonal?: boolean | null;
    ownerUserId?: string | null;
    projects: Array<{
      id: string;
      name: string;
      slug: string;
      apiKey?: string | null;
      isPersonal?: boolean | null;
      ownerUserId?: string | null;
      kind?: string | null;
    }>;
  }>;
};

function ApiKeyHost({ children }: { children: ReactNode }) {
  const { session, route, feedback, navigation } = useUiCapabilities();
  const activeScope = session.activeScope();
  const address = useUiAddress();

  const organizations = apiKeyApi.organization.getAll.useQuery({ isDemo: false });
  const graph = organizations.data as OrganizationGraphEntry[] | undefined;

  const organization = useMemo(
    () => graph?.find((candidate) => candidate.id === activeScope.organizationId),
    [graph, activeScope.organizationId],
  );

  const activeProject = useMemo(() => {
    if (!activeScope.projectId) return void 0;
    for (const team of organization?.teams ?? []) {
      const project = team.projects.find((candidate) => candidate.id === activeScope.projectId);
      if (project) return { project, teamId: team.id };
    }
    return void 0;
  }, [organization, activeScope.projectId]);

  // Everything the reader can SEE: the scope filter's options, and the names the
  // per-row scope chips resolve their ids to. Deliberately wider than the
  // RBAC-filtered set the drawers' chip picker writes to — narrowing the filter
  // to writable scopes would hide keys a project-only reader may read.
  const availableScopes = useMemo<ApiKeyAvailableScopes>(() => {
    const teams = organization?.teams ?? [];
    return {
      organization: organization ? { id: organization.id, name: organization.name } : null,
      teams: teams.map((team) => ({ id: team.id, name: team.name })),
      projects: teams.flatMap((team) =>
        team.projects.map((project) => ({
          id: project.id,
          name: project.name,
          teamId: team.id,
        })),
      ),
    };
  }, [organization]);

  // The whole graph the CLI project picker walks. Passed through rather than
  // narrowed: the picker's questions are about ownership and kind, and a
  // projection that dropped either would silently offer a colleague's personal
  // workspace, which is the historical hazard the resolver exists to prevent.
  const hostOrganizations = useMemo<ApiKeyOrganization[] | undefined>(
    () =>
      graph?.map((entry) => ({
        id: entry.id,
        name: entry.name,
        teams: entry.teams.map((team) => ({
          id: team.id,
          name: team.name,
          isPersonal: team.isPersonal,
          projects: team.projects.map((project) => ({
            id: project.id,
            name: project.name,
            slug: project.slug,
            isPersonal: project.isPersonal,
            ownerUserId: project.ownerUserId,
            kind: project.kind,
          })),
        })),
      })),
    [graph],
  );

  const actor = session.currentUser();

  /**
   * Three states from two answers, and the order matters.
   *
   * `/cli/auth` bounces a reader with no session through SSO, so reading "not
   * signed in" one render too early would send a signed-in reader on a
   * round-trip through sign-in. `isSettled()` is false until the organization
   * read has answered, and `/cli/auth` is NOT in `UI_PUBLIC_ROUTES`, so that
   * read is enabled from the first render and the loading state is real rather
   * than incidental.
   */
  const sessionStatus: ApiKeySessionStatus = actor
    ? "authenticated"
    : session.isSettled()
      ? "unauthenticated"
      : "loading";

  const reading = route.reading();
  const host = useMemo(
    () =>
      UiApiKeyHost.create(
        {
          scope: {
            organizationId: activeScope.organizationId ?? void 0,
            organizationName: organization?.name,
            teamId: activeProject?.teamId,
            projectId: activeScope.projectId ?? void 0,
            projectName: activeProject?.project.name,
            projectSlug: activeProject?.project.slug,
            projectApiKey: activeProject?.project.apiKey ?? void 0,
          },
          availableScopes,
          organizations: hostOrganizations,
          currentUser: actor ? { id: actor.id } : null,
          sessionStatus,
          apiEndpoint: readApiEndpoint(),
          route: { ...reading, fragment: fragmentOf(address) },
        },
        {
          hasPermission: (permission) => session.hasPermission(permission),
          setQuery: (next, options) => route.setQuery(next, options),
          replace: (to) => navigation.replace(to),
          navigate: (to) => navigation.navigate(to),
          succeeded: (notice) => feedback.succeeded(notice),
          failed: (failure) => feedback.failed(failure),
          writeClipboard: writeUiClipboard,
          visitStorage: browserUiSessionStorage,
          lookupDeviceCode: lookupCliDeviceCode,
          approveDeviceCode: approveCliDeviceCode,
          denyDeviceCode: denyCliDeviceCode,
        },
      ),
    [
      activeScope.organizationId,
      activeScope.projectId,
      organization,
      activeProject,
      availableScopes,
      hostOrganizations,
      actor,
      sessionStatus,
      address,
      reading,
      route,
      session,
      feedback,
      navigation,
    ],
  );

  return <ApiKeyHostProvider value={host}>{children}</ApiKeyHostProvider>;
}

/** Wraps an API Key screen in the host its package asks for. */
export function withApiKeyHost<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  const Mounted = (props: P) => (
    <ApiKeyHost>
      <Screen {...props} />
    </ApiKeyHost>
  );
  Mounted.displayName = `withApiKeyHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}
