/**
 * What the analytics screens are mounted inside: the tRPC Provider their
 * hooks run on, and the host port for project, grants, address and feedback.
 */

import {
  analyticsApi,
  AnalyticsHostProvider,
  type AnalyticsHostPort,
} from "@langwatch/analytics-web/screens/analytics";
import { useMemo, type ReactNode } from "react";

import { useUiCapabilities } from "@langwatch/ui-host/capabilities";
import { useUiShellFailure } from "../../../../behavior/ui-shell-failure";
import { UiPageFailure, UiPageLoading } from "../../../../ui/elements/ui-page-fallbacks";
import { resolveAnalyticsProject } from "../../behavior/analytics-project";

export function AnalyticsHost({ children }: { children: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();

  const organizations = analyticsApi.organization.getAll.useQuery({ isDemo: false });

  // A refused graph is a state, not an empty one: the project below is read
  // off this query, so a refusal left the analytics screen empty forever.
  const failure = useUiShellFailure({
    error: organizations.error,
    fallbackTitle: "Couldn't load your analytics",
  });

  const project = useMemo(
    () =>
      resolveAnalyticsProject({
        organizations: organizations.data ?? [],
        projectId: scope.projectId ?? undefined,
      }),
    [organizations.data, scope.projectId],
  );

  const reading = route.reading();
  const host = useMemo<AnalyticsHostPort>(
    () => ({
      project: () => project,
      organizationId: () => scope.organizationId ?? void 0,
      hasPermission: (permission) => session.hasPermission(permission),
      route: () => reading,
      setQuery: (next, options) => route.setQuery(next, options),
      navigate: (to) => navigation.navigate(to),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
    }),
    [project, scope.organizationId, session, reading, route, navigation, feedback],
  );

  if (failure.departing) return <UiPageLoading />;
  if (failure.copy) return <UiPageFailure copy={failure.copy} />;

  return <AnalyticsHostProvider value={host}>{children}</AnalyticsHostProvider>;
}
