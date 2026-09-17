/**
 * What `/:project/traces` and `/share/:id` mount inside: the tRPC Provider,
 * and the host port for project/team/org/reader/grants/feedback — one
 * `organization.getAll` read, skipped for `/share/:id` to avoid a 401.
 */

import { traceApi, TraceHostProvider, type TraceHostApi } from "@langwatch/trace-web/traces";
import { useMemo, type ReactNode } from "react";

import { useUiCapabilities } from "@langwatch/ui-host/capabilities";
import { useUiShellFailure } from "../../../../behavior/ui-shell-failure";
import { UiPageFailure, UiPageLoading } from "../../../../ui/sections/ui-page-fallbacks";
import { mergeTraceQuery } from "../../behavior/trace-merge-query";

function traceProject(
  project: ReturnType<TraceHostApi["project"]>,
): ReturnType<TraceHostApi["project"]> {
  if (!project) return void 0;
  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    ...(project.apiKey === void 0 ? {} : { apiKey: project.apiKey }),
    ...(project.firstMessage === void 0 ? {} : { firstMessage: project.firstMessage }),
    ...(project.presenceEnabled === void 0 ? {} : { presenceEnabled: project.presenceEnabled }),
  };
}

function traceOrganization(
  organization: ReturnType<TraceHostApi["organization"]>,
): ReturnType<TraceHostApi["organization"]> {
  if (!organization) return void 0;
  return {
    id: organization.id,
    name: organization.name,
    ...(organization.slug === void 0 ? {} : { slug: organization.slug }),
    ...(organization.presenceEnabled === void 0
      ? {}
      : { presenceEnabled: organization.presenceEnabled }),
  };
}

function traceTeam(team: ReturnType<TraceHostApi["team"]>): ReturnType<TraceHostApi["team"]> {
  if (!team) return void 0;
  return {
    id: team.id,
    name: team.name,
    ...(team.isPersonal === void 0 ? {} : { isPersonal: team.isPersonal }),
    ...(team.ownerUserId === void 0 ? {} : { ownerUserId: team.ownerUserId }),
    ...(team.members === void 0 ? {} : { members: team.members }),
  };
}

function traceUser(
  user: ReturnType<TraceHostApi["currentUser"]> | null,
): ReturnType<TraceHostApi["currentUser"]> {
  if (!user) return void 0;
  return { id: user.id, name: user.name, email: user.email, image: user.image };
}

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

  /** Project/team/org from one graph read. */
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
  const host = useMemo<TraceHostApi>(
    () => ({
      project: () => traceProject(placement?.project),
      organization: () => traceOrganization(placement?.organization),
      team: () => traceTeam(placement?.team),
      /**
       * Unanswered: the graph read carries no role, and Langy's gate treats
       * an unanswered role as "not an administrator" — the safe default,
       * since an admin who is also a team member passes on membership.
       */
      organizationRole: () => void 0,
      currentUser: () => traceUser(actor),
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
