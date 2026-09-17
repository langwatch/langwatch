/**
 * What the simulation screens are mounted inside: the tRPC Provider their
 * hooks run on, and the host port for project, team, organization, reader,
 * grants, address and feedback. `setQuery` merges over the reading here.
 */

import {
  scenarioApi,
  ScenarioHostProvider,
  type ScenarioHostApi,
} from "@langwatch/scenario-web/simulations";
import { useMemo, type ComponentType, type ReactNode } from "react";

import { useUiCapabilities } from "@langwatch/ui-host/capabilities";

function scenarioProject(
  project: ReturnType<ScenarioHostApi["project"]>,
): ReturnType<ScenarioHostApi["project"]> {
  if (!project) return void 0;
  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    ...(project.apiKey === void 0 ? {} : { apiKey: project.apiKey }),
    ...(project.firstMessage === void 0 ? {} : { firstMessage: project.firstMessage }),
  };
}

function scenarioOrganization(
  organization: ReturnType<ScenarioHostApi["organization"]>,
): ReturnType<ScenarioHostApi["organization"]> {
  if (!organization) return void 0;
  return {
    id: organization.id,
    name: organization.name,
    ...(organization.slug === void 0 ? {} : { slug: organization.slug }),
  };
}

function scenarioTeam(
  team: ReturnType<ScenarioHostApi["team"]>,
): ReturnType<ScenarioHostApi["team"]> {
  if (!team) return void 0;
  return {
    id: team.id,
    name: team.name,
    ...(team.isPersonal === void 0 ? {} : { isPersonal: team.isPersonal }),
    ...(team.ownerUserId === void 0 ? {} : { ownerUserId: team.ownerUserId }),
    ...(team.members === void 0 ? {} : { members: team.members }),
  };
}

function scenarioUser(
  user: ReturnType<ScenarioHostApi["currentUser"]> | null,
): ReturnType<ScenarioHostApi["currentUser"]> {
  if (!user) return void 0;
  return { id: user.id, name: user.name, email: user.email, image: user.image };
}

export function ScenarioHost({ children }: { children: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();
  const actor = session.currentUser();

  const organizations = scenarioApi.organization.getAll.useQuery(
    { isDemo: false },
    { enabled: !!actor },
  );

  const placement = useMemo(() => {
    if (!scope.projectId) return void 0;
    for (const organization of organizations.data ?? []) {
      for (const team of organization.teams) {
        const found = team.projects.find(
          (candidate: { id: string }) => candidate.id === scope.projectId,
        );
        if (found) return { organization, team, project: found };
      }
    }
    return void 0;
  }, [organizations.data, scope.projectId]);

  const reading = route.reading();

  const host = useMemo<ScenarioHostApi>(
    () => ({
      project: () => scenarioProject(placement?.project),
      organization: () => scenarioOrganization(placement?.organization),
      team: () => scenarioTeam(placement?.team),
      // The graph read doesn't carry it, and nothing here turns on it —
      // every gate reads a grant instead.
      organizationRole: () => void 0,
      currentUser: () => scenarioUser(actor),
      hasPermission: (permission) => session.hasPermission(permission),
      isLoading: () => !!actor && organizations.isLoading,
      /**
       * The splat included. `/:project/simulations/*` is one page serving
       * five addresses, and `params["*"]` is how it knows which.
       */
      route: () => ({
        params: {
          ...reading.params,
          path: (reading.params["*"] ?? "").split("/").filter(Boolean),
        },
        query: reading.query,
        pathname: reading.pathname ?? "",
      }),
      setQuery: (next, options) => route.setQuery({ ...reading.query, ...next }, options),
      navigate: (to, options) =>
        options?.replace ? navigation.replace(to) : navigation.navigate(to),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
    }),
    [placement, actor, session, organizations.isLoading, reading, route, navigation, feedback],
  );

  return <ScenarioHostProvider value={host}>{children}</ScenarioHostProvider>;
}

/**
 * Wraps one of this family's drawers in the same host: `CurrentDrawer`
 * mounts above the outlet, so a drawer opened elsewhere renders outside
 * whatever provider the page below brought.
 */
export function withScenarioDrawerHost<P extends object>(
  Drawer: ComponentType<P>,
): ComponentType<P> {
  const Mounted = (props: P) => (
    <ScenarioHost>
      <Drawer {...props} />
    </ScenarioHost>
  );
  Mounted.displayName = `withScenarioDrawerHost(${Drawer.displayName ?? Drawer.name ?? "Drawer"})`;
  return Mounted;
}
