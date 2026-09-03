/**
 * What the trace screens are mounted inside.
 *
 * Two things go around `/:project/traces` and `/share/:id`: the tRPC Provider
 * the package's own hooks run on, and the host port that answers for the
 * project, the team it sits on, the organization, the reader, their grants, the
 * address and the feedback. Both are mounted here, once, so a screen module
 * stays a screen module.
 *
 * The reads live here rather than in the adapter for a reason worth keeping:
 * the adapter is a value object over what has already been read, so a test
 * constructs one, while a hook cannot be constructed at all.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product
 * want it. This family reads it for four answers — which project the address is
 * about, which team it sits on, whether that team is the reader's own personal
 * workspace, and whether presence is switched on above it.
 *
 * THE GRAPH READ IS SKIPPED WHEN THERE IS NO READER, and that is what lets the
 * same host serve the shared-trace page: `/share/:id` is reachable signed out,
 * `organization.getAll` is protected, and asking it there would 401 on every
 * load of a link that is meant to work for somebody with no account at all. The
 * shared page needs none of the graph's answers — its whole payload arrives
 * with the token — so the host answers `undefined` for all four and the screen
 * renders read-only, which is what it did in `platform/app`.
 */

import {
  setTraceErrorHost,
  traceApi,
  TraceHostProvider,
} from "@langwatch/trace-web/screens/traces";
import { useEffect, useMemo, type ComponentType, type ReactNode } from "react";
import { useLocation } from "react-router";

import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { UiTraceHost } from "../../behavior/host.adapter";

function TraceHost({ children }: { children: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();
  const actor = session.currentUser();
  const location = useLocation();

  const organizations = traceApi.organization.getAll.useQuery(
    { isDemo: false },
    { enabled: !!actor },
  );

  /**
   * The project the address is about, and the team and organization above it.
   *
   * Resolved from the one graph read rather than from three queries. Without a
   * project in scope the explorer renders its empty shell, which is what the
   * platform page did: every trace belongs to a project.
   */
  const placement = useMemo(() => {
    if (!scope.projectId) return void 0;
    for (const organization of organizations.data ?? []) {
      for (const team of organization.teams) {
        const found = team.projects.find((candidate) => candidate.id === scope.projectId);
        if (found) return { organization, team, project: found };
      }
    }
    return void 0;
  }, [organizations.data, scope.projectId]);

  const reading = route.reading();
  const host = useMemo(
    () =>
      UiTraceHost.create(
        {
          project: placement
            ? {
                id: placement.project.id,
                slug: placement.project.slug,
                name: placement.project.name,
                ...(placement.project.apiKey === void 0
                  ? {}
                  : { apiKey: placement.project.apiKey }),
                ...(placement.project.firstMessage === void 0
                  ? {}
                  : { firstMessage: placement.project.firstMessage }),
                ...(placement.project.presenceEnabled === void 0
                  ? {}
                  : { presenceEnabled: placement.project.presenceEnabled }),
              }
            : void 0,
          organization: placement
            ? {
                id: placement.organization.id,
                name: placement.organization.name,
                ...(placement.organization.slug === void 0
                  ? {}
                  : { slug: placement.organization.slug }),
                ...(placement.organization.presenceEnabled === void 0
                  ? {}
                  : { presenceEnabled: placement.organization.presenceEnabled }),
              }
            : void 0,
          team: placement
            ? {
                id: placement.team.id,
                name: placement.team.name,
                ...(placement.team.isPersonal === void 0
                  ? {}
                  : { isPersonal: placement.team.isPersonal }),
                ...(placement.team.ownerUserId === void 0
                  ? {}
                  : { ownerUserId: placement.team.ownerUserId }),
                ...(placement.team.members === void 0 ? {} : { members: placement.team.members }),
              }
            : void 0,
          /**
           * The reader's standing in the organization.
           *
           * The graph read does not carry it, and the one gate that asks —
           * Langy's — treats an unanswered role as "not an administrator",
           * which is the safe reading: an administrator who is also a member of
           * the team passes the same gate on the membership branch.
           */
          organizationRole: void 0,
          currentUser: actor
            ? { id: actor.id, name: actor.name, email: actor.email, image: actor.image }
            : void 0,
          hasPermission: (permission: string) => session.hasPermission(permission),
          isLoading: !!actor && organizations.isLoading,
          route: { ...reading, pathname: location.pathname },
        },
        {
          setQuery: (next, options) => route.setQuery(next, options),
          navigate: (to, options) =>
            options?.replace ? navigation.replace(to) : navigation.navigate(to),
          succeeded: (notice) => feedback.succeeded(notice),
          failed: (failure) => feedback.failed(failure),
        },
      ),
    [
      placement,
      actor,
      session,
      organizations.isLoading,
      reading,
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
    setTraceErrorHost(host);
    return () => setTraceErrorHost(void 0);
  }, [host]);

  return <TraceHostProvider value={host}>{children}</TraceHostProvider>;
}

/** Wraps a trace screen in the host its package asks for. */
export function withTraceHost<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  const Mounted = (props: P) => (
    <TraceHost>
      <Screen {...props} />
    </TraceHost>
  );
  Mounted.displayName = `withTraceHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}
