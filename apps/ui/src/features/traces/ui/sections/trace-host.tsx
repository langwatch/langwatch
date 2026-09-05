/**
 * What `/:project/traces` and `/share/:id` mount inside: the tRPC Provider,
 * and the host port for project/team/org/reader/grants/feedback — one
 * `organization.getAll` read, skipped for `/share/:id` to avoid a 401.
 */

import {
  traceApi,
  TraceHostProvider,
  type TraceHostPort,
} from "@langwatch/trace-web/screens/traces";
import { useMemo, type ReactNode } from "react";

import { useUiCapabilities } from "@langwatch/ui-host/capabilities";
import { useUiShellFailure } from "../../../../behavior/ui-shell-failure";
import { UiPageFailure, UiPageLoading } from "../../../../ui/sections/ui-page-fallbacks";
import { mergeTraceQuery } from "../../behavior/trace-merge-query";

export function TraceHost({ children }: { children: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();
  const actor = session.currentUser();

  const organizations = traceApi.organization.getAll.useQuery(
    { isDemo: false },
    { enabled: !!actor },
  );

  // A refused graph is a state, not an empty one: `placement` below reads the
  // project, team and organization off this query, so a failed read left the
  // trace page with no placement forever — `isLoading` stayed the only signal
  // and it goes false on a settled error, stranding the page on a spinner
  // that never becomes an error. Same pattern as `OrganizationHost`.
  const failure = useUiShellFailure({
    error: organizations.error,
    fallbackTitle: "Couldn't load your traces",
  });

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
      route: () => ({ ...reading, pathname: reading.pathname ?? "" }),
      setQuery: (next, options) =>
        route.setQuery(mergeTraceQuery({ current: reading.query, next }), options),
      navigate: (to, options) =>
        options?.replace ? navigation.replace(to) : navigation.navigate(to),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
    }),
    [placement, actor, session, organizations.isLoading, reading, route, navigation, feedback],
  );

  if (failure.departing) return <UiPageLoading />;
  if (failure.copy) return <UiPageFailure copy={failure.copy} />;

  return <TraceHostProvider value={host}>{children}</TraceHostProvider>;
}
