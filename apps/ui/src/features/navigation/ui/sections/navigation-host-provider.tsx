/**
 * What the landing page and the project switcher are mounted inside.
 *
 * Two things go around them: the tRPC Provider the package's own hooks run on,
 * and the host port that answers for the workspace graph, the reader, the
 * grants, the flags, this device's scope memory and the two navigations.
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
 * for the answer rather than the rules, so the switcher and the LLM Ops home
 * offer exactly the teams the chrome would render a page for.
 */

import {
  navigationApi,
  NavigationHostProvider,
  type NavigationOrganization,
  type NavigationTeam,
} from "@langwatch/navigation-web/screens/landing";
import { useMemo, type ComponentType, type ReactNode } from "react";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { selectAmbientTeam, userCanOpenTeam } from "../../../../behavior/ui-scope-resolution";
import { useUiScopeMemory } from "../../../../behavior/ui-scope-storage";
import { UiPageLoading } from "../../../../ui/elements/ui-page-fallbacks";
import { UiNavigationHost } from "../../behavior/navigation-host.adapter";

/**
 * The graph, in the navigation package's own vocabulary.
 *
 * A narrowing rather than a translation: every field below is already on the
 * procedure's answer, and the ones this application carries and the package does
 * not (slugs on teams, owner ids) simply do not travel.
 */
function toNavigationOrganizations(
  organizations: ReadonlyArray<{
    id: string;
    name: string;
    members?: Array<{ role: string }>;
    teams: Array<{
      id: string;
      name: string;
      isPersonal?: boolean | null;
      members?: Array<{ userId: string }>;
      projects: Array<{ id: string; name: string; slug: string }>;
    }>;
  }>,
): NavigationOrganization[] {
  return organizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
    teams: organization.teams.map((team) => ({
      id: team.id,
      name: team.name,
      isPersonal: team.isPersonal,
      members: team.members,
      projects: team.projects.map((project) => ({
        id: project.id,
        name: project.name,
        slug: project.slug,
      })),
    })),
  }));
}

/**
 * Mounts the host above whatever it wraps.
 *
 * Exported because the CHROME mounts it once, above the outlet, rather than
 * once per screen: the switcher in the header and the screen below it have to
 * be looking at the same workspace graph, and one provider is what makes them.
 */
export function NavigationHostSection({ children }: { children: ReactNode }) {
  const { session, navigation } = useUiCapabilities();
  const activeScope = session.activeScope();
  const memory = useUiScopeMemory();

  const organizations = navigationApi.organization.getAll.useQuery({ isDemo: false });

  const graph = useMemo(
    () => toNavigationOrganizations(organizations.data ?? []),
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
      (organizations.data ?? []).find(
        (candidate) => candidate.id === activeScope.organizationId,
      )?.members?.[0]?.role,
    [organizations.data, activeScope.organizationId],
  );

  const project = useMemo(() => {
    if (!activeScope.projectId) return void 0;
    for (const candidate of graph) {
      for (const team of candidate.teams) {
        const found = team.projects.find((entry) => entry.id === activeScope.projectId);
        if (found) return { ...found, isPersonal: team.isPersonal };
      }
    }
    return void 0;
  }, [graph, activeScope.projectId]);

  const currentUserId = session.currentUser()?.id;

  /**
   * The teams this reader may open, in the order the shell resolves an ambient
   * one: the ambient team first, then the rest of what they can reach.
   */
  const openableTeams: readonly NavigationTeam[] = useMemo(() => {
    const teams = organization?.teams ?? [];
    const reachable = teams.filter((team) =>
      userCanOpenTeam({
        team,
        userId: currentUserId,
        organizationRole,
      }),
    );
    const ambient = selectAmbientTeam({ teams: reachable, userId: currentUserId });
    if (!ambient) return reachable;
    return [ambient, ...reachable.filter((team) => team.id !== ambient.id)];
  }, [organization, currentUserId, organizationRole]);

  const host = useMemo(
    () =>
      UiNavigationHost.create(
        {
          organizations: graph,
          organization,
          project,
          openableTeams,
          // The graph is what every answer above is read off, so "still
          // arriving" is exactly this query being unsettled.
          isLoading: organizations.isLoading,
          currentUserId,
          organizationRole,
          rememberedProjectSlug: memory.selection.projectSlug,
          lastVisitedHomeKind: memory.lastVisitedHomeKind as "" | "project" | "personal",
          waiting: <UiPageLoading />,
        },
        {
          hasPermission: (permission) => session.hasPermission(permission),
          featureFlag: (flag) => {
            const answer = session.featureFlag(flag);
            return { enabled: answer === true, isLoading: answer === void 0 };
          },
          replace: (to) => navigation.replace(to),
          navigate: (to) => navigation.navigate(to),
        },
      ),
    [
      graph,
      organization,
      project,
      openableTeams,
      organizations.isLoading,
      currentUserId,
      organizationRole,
      memory,
      session,
      navigation,
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
