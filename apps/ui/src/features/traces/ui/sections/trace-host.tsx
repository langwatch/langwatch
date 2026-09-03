/**
 * What `/:project/traces` and `/share/:id` mount inside: the tRPC Provider,
 * and the host port for project/team/org/reader/grants/feedback — one
 * `organization.getAll` read, skipped for `/share/:id` to avoid a 401.
 */

import {
  setTraceErrorHost,
  traceApi,
  TraceHostProvider,
  type TraceHostPort,
} from "@langwatch/trace-web/screens/traces";
import { useEffect, useMemo, type ReactNode } from "react";
import { useLocation } from "react-router";

import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { mergeTraceQuery } from "../../behavior/trace-merge-query";

export function TraceHost({ children }: { children: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();
  const actor = session.currentUser();
  const location = useLocation();

  const organizations = traceApi.organization.getAll.useQuery(
    { isDemo: false },
    { enabled: !!actor },
  );

  /** The project, team and organization the address is about — from the one graph read rather than three queries. */
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
  const host = useMemo<TraceHostPort>(
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
              ...(placement.project.presenceEnabled === void 0
                ? {}
                : { presenceEnabled: placement.project.presenceEnabled }),
            }
          : void 0,
      organization: () =>
        placement
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
      team: () =>
        placement
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
       * Unanswered: the graph read carries no role, and Langy's gate treats
       * an unanswered role as "not an administrator" — the safe default,
       * since an admin who is also a team member passes on membership.
       */
      organizationRole: () => void 0,
      currentUser: () =>
        actor ? { id: actor.id, name: actor.name, email: actor.email, image: actor.image } : void 0,
      hasPermission: (permission) => session.hasPermission(permission),
      isLoading: () => !!actor && organizations.isLoading,
      route: () => ({ ...reading, pathname: location.pathname }),
      setQuery: (next, options) =>
        route.setQuery(mergeTraceQuery({ current: reading.query, next }), options),
      navigate: (to, options) =>
        options?.replace ? navigation.replace(to) : navigation.navigate(to),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
    }),
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
   * Published for `onError`, where no hook can run — the package keeps a
   * module-scope host instead. Set every render, since `host` is a new
   * value object whenever the scope moves.
   */
  useEffect(() => {
    setTraceErrorHost(host);
    return () => setTraceErrorHost(void 0);
  }, [host]);

  return <TraceHostProvider value={host}>{children}</TraceHostProvider>;
}
