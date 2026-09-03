/**
 * What the analytics screens are mounted inside.
 *
 * Two things go around `/:project/analytics` and its eight sibling addresses:
 * the tRPC Provider the package's own hooks run on, and the host port that
 * answers for the project, the reader's grants, the address and the feedback.
 * Both are mounted here, once, so a screen module stays a screen module.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product
 * want it.
 */

import {
  analyticsApi,
  AnalyticsHostProvider,
  type AnalyticsHostPort,
} from "@langwatch/analytics-web/screens/analytics";
import { useMemo, type ReactNode } from "react";

import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { resolveAnalyticsProject } from "../../behavior/analytics-project";

export function AnalyticsHost({ children }: { children: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();

  const organizations = analyticsApi.organization.getAll.useQuery({ isDemo: false });

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

  return <AnalyticsHostProvider value={host}>{children}</AnalyticsHostProvider>;
}
