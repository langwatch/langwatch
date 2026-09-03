/**
 * What the simulation screens are mounted inside.
 *
 * Two things go around `/:project/simulations/*`, `/:project/simulations/scenarios`
 * and `/:project/agent-testing/*`: the tRPC Provider the package's own hooks
 * run on, and the host port that answers for the project, the team it sits on,
 * the organization, the reader, their grants, the address and the feedback.
 * Both are mounted here, once, so a screen module stays a screen module.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product
 * want it.
 *
 * `setQuery` MERGES here, over the reading, because `UiRoutePort.setQuery`
 * replaces the whole query and these screens do not own their address alone.
 */

import {
  scenarioApi,
  ScenarioHostProvider,
  setScenarioErrorHost,
  type ScenarioHostPort,
} from "@langwatch/scenario-web/screens/simulations";
import { useEffect, useMemo, type ComponentType, type ReactNode } from "react";
import { useLocation, useParams } from "react-router";

import { useUiCapabilities } from "../../../../behavior/ui-capabilities";

export function ScenarioHost({
  children,
  publishFailures = true,
}: {
  children: ReactNode;
  /**
   * Whether this mount owns the package's module-scope failure host.
   *
   * TRUE FOR A PAGE AND FALSE FOR A DRAWER, because the two are SIBLINGS
   * rather than nested: `CurrentDrawer` is mounted above the outlet, so a
   * drawer's host is a second provider standing beside the page's, not inside
   * it. `setScenarioErrorHost` is a plain assignment, so two publishers means
   * the drawer's unmount clears the singleton the page is still using — and
   * every `showErrorToast` the page raises afterwards degrades to a console
   * warning. The drawer loses nothing by staying off it: the singleton exists
   * to reach the application's feedback capability, which is the same
   * capability whichever host published it.
   */
  publishFailures?: boolean;
}) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();
  const actor = session.currentUser();
  const location = useLocation();
  const params = useParams();

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

  const host = useMemo<ScenarioHostPort>(
    () => ({
      project: () =>
        placement
          ? {
              id: placement.project.id,
              slug: placement.project.slug,
              name: placement.project.name,
              ...(placement.project.apiKey === void 0 ? {} : { apiKey: placement.project.apiKey }),
              ...(placement.project.firstMessage === void 0
                ? {}
                : { firstMessage: placement.project.firstMessage }),
            }
          : void 0,
      organization: () =>
        placement
          ? {
              id: placement.organization.id,
              name: placement.organization.name,
              ...(placement.organization.slug === void 0 ? {} : { slug: placement.organization.slug }),
            }
          : void 0,
      team: () =>
        placement
          ? {
              id: placement.team.id,
              name: placement.team.name,
              ...(placement.team.isPersonal === void 0 ? {} : { isPersonal: placement.team.isPersonal }),
              ...(placement.team.ownerUserId === void 0
                ? {}
                : { ownerUserId: placement.team.ownerUserId }),
              ...(placement.team.members === void 0 ? {} : { members: placement.team.members }),
            }
          : void 0,
      /**
       * The reader's standing in the organization.
       *
       * The graph read does not carry it, and nothing this family renders
       * turns on it — every gate here reads a grant instead.
       */
      organizationRole: () => void 0,
      currentUser: () =>
        actor ? { id: actor.id, name: actor.name, email: actor.email, image: actor.image } : void 0,
      hasPermission: (permission) => session.hasPermission(permission),
      isLoading: () => !!actor && organizations.isLoading,
      /**
       * The splat included. `/:project/simulations/*` is one page serving
       * five addresses, and `params["*"]` is how it knows which.
       */
      route: () => ({
        params: { ...params, path: (params["*"] ?? "").split("/").filter(Boolean) },
        query: reading.query,
        pathname: location.pathname,
      }),
      setQuery: (next, options) => route.setQuery({ ...reading.query, ...next }, options),
      navigate: (to, options) => (options?.replace ? navigation.replace(to) : navigation.navigate(to)),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
    }),
    [
      placement,
      actor,
      session,
      organizations.isLoading,
      reading,
      params,
      location.pathname,
      route,
      navigation,
      feedback,
    ],
  );

  /**
   * The failure singleton, published for the mutation callbacks.
   *
   * `showErrorToast` fires from `onError`, where no hook can run, so the
   * package keeps a module-scope host. Set on every render rather than once,
   * because the host is a new value object whenever the scope moves.
   */
  useEffect(() => {
    if (!publishFailures) return;
    setScenarioErrorHost(host);
    return () => setScenarioErrorHost(void 0);
  }, [host, publishFailures]);

  return <ScenarioHostProvider value={host}>{children}</ScenarioHostProvider>;
}

/**
 * Wraps one of this family's DRAWERS in the same host.
 *
 * A drawer needs its own mount for the reason the studio's six recorded: the
 * registry's host is mounted above the outlet, so a drawer opened from a
 * workflow, a trace or the command palette renders outside whatever provider
 * the page below it brought. What it does not take with it is the failure
 * singleton — see `publishFailures`.
 */
export function withScenarioDrawerHost<P extends object>(
  Drawer: ComponentType<P>,
): ComponentType<P> {
  const Mounted = (props: P) => (
    <ScenarioHost publishFailures={false}>
      <Drawer {...props} />
    </ScenarioHost>
  );
  Mounted.displayName = `withScenarioDrawerHost(${Drawer.displayName ?? Drawer.name ?? "Drawer"})`;
  return Mounted;
}
