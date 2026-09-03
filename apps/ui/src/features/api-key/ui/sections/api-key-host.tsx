/**
 * What the two API Key screens are mounted inside: the tRPC Provider their
 * hooks run on, and the host port for scope, grants, org graph, session,
 * address, feedback, clipboard, lead-source and the CLI device-flow calls.
 */

import {
  apiKeyApi,
  ApiKeyHostProvider,
  type ApiKeyAvailableScopes,
  type ApiKeyHostPort,
  type ApiKeyOrganization,
  type ApiKeySessionStatus,
} from "@langwatch/api-key-web/screens/api-key";
import { useMemo, type ReactNode } from "react";
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
import { DRAWER_OPEN_PARAM } from "../../../drawers";
import { copyToClipboard } from "../../behavior/api-key-clipboard";
import { recordLeadSourceIfAbsent } from "../../behavior/api-key-lead-source";
import { openPlatformDrawer } from "../../behavior/api-key-platform-drawer";

/**
 * Where the API a minted key will be used against lives: no configured base
 * URL means a self-hosted deployment with none stated, not a broken one, so
 * this falls back to the same cloud endpoint `build-mcp-config` defaults to.
 */
function readApiEndpoint(): string {
  try {
    return readPublicAppConfig().appBaseUrl;
  } catch {
    return "https://app.langwatch.ai";
  }
}

/**
 * The `#...` part of the address, without the hash. `UiRoutePort` carries no
 * fragment and a screen may not read `window.location`, so this comes off
 * the global layer's `useUiAddress` — the seam keeping `react-router` out.
 */
function fragmentOf(address: string): string {
  const hash = address.indexOf("#");
  return hash === -1 ? "" : address.slice(hash + 1);
}

/**
 * The organization graph, narrowed to what the two screens read: the
 * package's own port shape, plus the active project's name (scope chip)
 * and legacy `apiKey` (the one row that renders one).
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

export function ApiKeyHost({ children }: { children: ReactNode }) {
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
   * Three states from two answers, order matters: `/cli/auth` bounces a
   * signed-out reader through SSO, so reading "not signed in" one render too
   * early would round-trip a signed-in reader. `isSettled()` gates it.
   */
  const sessionStatus: ApiKeySessionStatus = actor
    ? "authenticated"
    : session.isSettled()
      ? "unauthenticated"
      : "loading";

  const reading = route.reading();

  const host = useMemo<ApiKeyHostPort>(
    () => ({
      scope: () => ({
        organizationId: activeScope.organizationId ?? void 0,
        organizationName: organization?.name,
        teamId: activeProject?.teamId,
        projectId: activeScope.projectId ?? void 0,
        projectName: activeProject?.project.name,
        projectSlug: activeProject?.project.slug,
        projectApiKey: activeProject?.project.apiKey ?? void 0,
      }),
      hasPermission: (permission) => session.hasPermission(permission),
      availableScopes: () => availableScopes,
      organizations: () => hostOrganizations,
      currentUser: () => (actor ? { id: actor.id } : null),
      sessionStatus: () => sessionStatus,
      apiEndpoint: () => readApiEndpoint(),
      route: () => ({ ...reading, fragment: fragmentOf(address) }),
      setQuery: (next, options) => route.setQuery(next, options),
      replace: (to) => navigation.replace(to),
      navigate: (to) => navigation.navigate(to),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
      copyToClipboard: ({ text, succeeded }) =>
        copyToClipboard({
          text,
          succeeded,
          writeClipboard: writeUiClipboard,
          onSucceeded: feedback.succeeded,
          onFailed: feedback.failed,
        }),
      recordLeadSourceIfAbsent: (source) =>
        recordLeadSourceIfAbsent({ storage: browserUiSessionStorage, source }),
      openPlatformDrawer: ({ drawer, params }) =>
        openPlatformDrawer({
          query: reading.query,
          drawer,
          params,
          openParam: DRAWER_OPEN_PARAM,
          setQuery: route.setQuery,
        }),
      lookupDeviceCode: lookupCliDeviceCode,
      approveDeviceCode: approveCliDeviceCode,
      denyDeviceCode: denyCliDeviceCode,
    }),
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
