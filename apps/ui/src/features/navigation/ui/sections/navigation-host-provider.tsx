/**
 * What the navigation package's screens and the application chrome are mounted
 * inside.
 *
 * Two things go around them: the tRPC Provider the package's own hooks run on,
 * and the host port that answers for the workspace graph, the reader, the
 * grants, the flags, the deployment, this device's scope memory and the
 * navigations.
 *
 * The reads live here rather than in the adapter for a reason worth keeping:
 * the adapter is a value object over what has already been read, so a test
 * constructs one, while a hook cannot be constructed at all.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product want
 * it.
 *
 * WHICH TEAMS THE READER MAY OPEN is this application's own policy, and it is
 * already written down once, in `behavior/ui-scope-resolution`. The port asks
 * for the answer rather than the rules, so the switcher, the LLM Ops home and
 * the chrome offer exactly the teams a page would render for.
 */

import {
  navigationApi,
  NavigationHostProvider,
  type NavigationDeployment,
  type NavigationOrganization,
  type NavigationScopeWrite,
  type NavigationTeam,
  type NavigationUser,
} from "@langwatch/navigation-web/screens/landing";
import { useCallback, useMemo, type ComponentType, type ReactNode } from "react";
import { readPublicAppConfig } from "../../../../behavior/public-config";
import { useUiAddress } from "../../../../behavior/ui-address";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { useUiOrganizationFacts } from "../../../../behavior/ui-organization-facts";
import { selectAmbientTeam, userCanOpenTeam } from "../../../../behavior/ui-scope-resolution";
import {
  broadcastUiScopeWrite,
  useUiScopeMemory,
  writeUiScopeSelection,
} from "../../../../behavior/ui-scope-storage";
import { signOutUi } from "../../../../behavior/ui-session-client";
import { useUiRouteReading } from "../../../../behavior/ui-scope-route";
import { UiPageLoading } from "../../../../ui/elements/ui-page-fallbacks";
import { UiNavigationHost } from "../../behavior/navigation-host.adapter";

/** The two grants that decide how far a reader gets into the operations pages. */
const OPS_VIEW_PERMISSION = "ops:view";
const OPS_MANAGE_PERMISSION = "ops:manage";

/** The organization graph, narrowed to what the navigation package reads. */
type OrganizationsRead = ReadonlyArray<{
  id: string;
  name: string;
  members?: Array<{ role: string }>;
  teams: Array<{
    id: string;
    name: string;
    isPersonal?: boolean | null;
    ownerUserId?: string | null;
    members?: Array<{ userId: string }>;
    projects: Array<{
      id: string;
      name: string;
      slug: string;
      lastCodingAgentSessionAt?: string | Date | null;
      lastCodingAgentPullRequestAt?: string | Date | null;
    }>;
  }>;
}>;

/**
 * The graph, in the navigation package's own vocabulary.
 *
 * A narrowing rather than a translation: every field below is already on the
 * procedure's answer, and the ones this application carries and the package does
 * not (slugs on teams, owner ids on projects) simply do not travel.
 */
function toNavigationOrganizations(organizations: OrganizationsRead): NavigationOrganization[] {
  return organizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
    teams: organization.teams.map((team) => ({
      id: team.id,
      name: team.name,
      isPersonal: team.isPersonal,
      ownerUserId: team.ownerUserId,
      members: team.members,
      projects: team.projects.map((project) => ({
        id: project.id,
        name: project.name,
        slug: project.slug,
        isPersonal: team.isPersonal,
        lastCodingAgentSessionAt: project.lastCodingAgentSessionAt,
        lastCodingAgentPullRequestAt: project.lastCodingAgentPullRequestAt,
      })),
    })),
  }));
}

/**
 * What kind of deployment this is, off the config the HTML shell carries.
 *
 * A composition whose document has no config block is a self-hosted deployment
 * as far as every branch below goes, never a crash — the same shape
 * `readUiIsSaaS` takes for the same reason.
 */
function readDeployment(): NavigationDeployment {
  try {
    const config = readPublicAppConfig();
    return {
      isSaaS: config.deployment === "saas",
      isDevelopment: config.mode === "development",
      ...(config.demoProjectSlug ? { demoProjectSlug: config.demoProjectSlug } : {}),
      hasNlpService: config.capabilities.nlp,
      hasLangevals: config.capabilities.langevals,
    };
  } catch {
    return {
      isSaaS: false,
      isDevelopment: false,
      // A document with no config makes no claim about the analysis services,
      // and warning that two environment variables are unset on the strength
      // of a missing config block would be a false alarm on every test mount.
      hasNlpService: true,
      hasLangevals: true,
    };
  }
}

/**
 * Mounts the host above whatever it wraps.
 *
 * Exported because the CHROME mounts it once, above the outlet, rather than
 * once per screen: the switchers in the header, the sidebar and the screen
 * below them have to be looking at the same workspace graph, and one provider
 * is what makes them.
 */
export function NavigationHostSection({ children }: { children: ReactNode }) {
  const { session, navigation, documentTitle } = useUiCapabilities();
  const activeScope = session.activeScope();
  const memory = useUiScopeMemory();
  const facts = useUiOrganizationFacts();
  const routeReading = useUiRouteReading();
  const address = useUiAddress();

  const organizations = navigationApi.organization.getAll.useQuery({ isDemo: false });

  const graph = useMemo(
    () => toNavigationOrganizations((organizations.data ?? []) as OrganizationsRead),
    [organizations.data],
  );

  const organization = useMemo(
    () => graph.find((candidate) => candidate.id === activeScope.organizationId),
    [graph, activeScope.organizationId],
  );

  /**
   * The reader's role in the resolved organization.
   *
   * `organization.getAll` narrows `members` to the caller's own row, so the
   * first one IS the reader's membership. Read off the raw answer rather than
   * the narrowed graph, which deliberately does not carry memberships.
   */
  const organizationRole = useMemo(
    () =>
      ((organizations.data ?? []) as OrganizationsRead).find(
        (candidate) => candidate.id === activeScope.organizationId,
      )?.members?.[0]?.role,
    [organizations.data, activeScope.organizationId],
  );

  /** The team that holds the project on screen, which is where the chrome's
   * personal-workspace test and the cross-scope banner both read from. */
  const team = useMemo(() => {
    if (!activeScope.projectId) return void 0;
    for (const candidate of graph) {
      const found = candidate.teams.find((entry) =>
        entry.projects.some((project) => project.id === activeScope.projectId),
      );
      if (found) return found;
    }
    return void 0;
  }, [graph, activeScope.projectId]);

  const project = useMemo(
    () => team?.projects.find((entry) => entry.id === activeScope.projectId),
    [team, activeScope.projectId],
  );

  const actor = session.currentUser();
  const currentUser: NavigationUser | undefined = useMemo(
    () => (actor ? { ...actor } : void 0),
    [actor],
  );
  const currentUserId = actor?.id;

  /**
   * The teams this reader may open, in the order the shell resolves an ambient
   * one: the ambient team first, then the rest of what they can reach.
   */
  const openableTeams: readonly NavigationTeam[] = useMemo(() => {
    const teams = organization?.teams ?? [];
    const reachable = teams.filter((candidate) =>
      userCanOpenTeam({ team: candidate, userId: currentUserId, organizationRole }),
    );
    const ambient = selectAmbientTeam({ teams: reachable, userId: currentUserId });
    if (!ambient) return reachable;
    return [ambient, ...reachable.filter((candidate) => candidate.id !== ambient.id)];
  }, [organization, currentUserId, organizationRole]);

  const deployment = useMemo(readDeployment, []);

  /** The address, split the way the chrome reads it. */
  const [pathname = "/", search = ""] = useMemo(() => {
    const withoutHash = address.split("#")[0] ?? "";
    const queryAt = withoutHash.indexOf("?");
    return queryAt === -1
      ? [withoutHash, ""]
      : [withoutHash.slice(0, queryAt), withoutHash.slice(queryAt)];
  }, [address]);

  /**
   * The segments a catch-all captured, joined.
   *
   * `/@project/<rest>` is the only address that asks, and React Router hands
   * the rest of the path back under the `*` parameter.
   */
  const catchAllPath = routeReading.pathname.replace(/^\/@project\/?/, "");

  const setDocumentTitle = useCallback(
    (title: string) => documentTitle.set(title),
    [documentTitle],
  );
  /**
   * Writes a scope choice through the application's own storage seam.
   *
   * Broadcast on every write, because the application still serves most of the
   * product from the same origin and its mounted `useLocalStorage` readers see
   * a write only through that event.
   */
  const rememberScope = useCallback((write: NavigationScopeWrite) => {
    writeUiScopeSelection({
      writes: [
        ...(write.organizationId !== void 0
          ? [{ key: "organizationId" as const, value: write.organizationId }]
          : []),
        ...(write.projectSlug !== void 0
          ? [{ key: "projectSlug" as const, value: write.projectSlug }]
          : []),
      ],
      storage: window.localStorage,
      broadcast: broadcastUiScopeWrite,
    });
  }, []);
  const signOut = useCallback(() => {
    void signOutUi();
  }, []);

  const host = useMemo(
    () =>
      UiNavigationHost.create(
        {
          organizations: graph,
          organization,
          project,
          team,
          openableTeams,
          // The graph is what every answer above is read off, so "still
          // arriving" is exactly this query being unsettled.
          isLoading: organizations.isLoading,
          currentUser,
          organizationRole,
          rememberedProjectSlug: memory.selection.projectSlug,
          lastVisitedHomeKind: memory.lastVisitedHomeKind as "" | "project" | "personal",
          waiting: <UiPageLoading />,
          notFound: <UiPageLoading />,
          pathname,
          search,
          projectParam: routeReading.projectParam,
          catchAllPath,
          deployment,
          plan: {
            isEnterprise: facts.isEnterprise,
            isLoading: facts.isPlanLoading,
            isLiteMember: facts.isLiteMember,
          },
          opsAccess: {
            hasAccess: session.hasPermission(OPS_VIEW_PERMISSION),
            isAdmin: session.hasPermission(OPS_MANAGE_PERMISSION),
          },
        },
        {
          hasPermission: (permission) => session.hasPermission(permission),
          featureFlag: (flag) => {
            const answer = session.featureFlag(flag);
            return { enabled: answer === true, isLoading: answer === void 0 };
          },
          replace: (to) => navigation.replace(to),
          navigate: (to) => navigation.navigate(to),
          back: () => navigation.back(),
          rememberScope,
          signOut,
          setDocumentTitle,
        },
      ),
    [
      graph,
      organization,
      project,
      team,
      openableTeams,
      organizations.isLoading,
      currentUser,
      organizationRole,
      memory,
      pathname,
      search,
      routeReading.projectParam,
      catchAllPath,
      deployment,
      facts,
      session,
      navigation,
      rememberScope,
      signOut,
      setDocumentTitle,
    ],
  );

  return <NavigationHostProvider value={host}>{children}</NavigationHostProvider>;
}

/** Wraps a screen in the host the navigation package asks for. */
export function withNavigationHost<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  const Mounted = (props: P) => (
    <NavigationHostSection>
      <Screen {...props} />
    </NavigationHostSection>
  );
  Mounted.displayName = `withNavigationHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}

export { navigationApi };
