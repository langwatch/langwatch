/**
 * What the analytics screens are mounted inside.
 *
 * Two things go around `/:project/analytics` and its eight sibling addresses:
 * the tRPC Provider the package's own hooks run on, and the host port that
 * answers for the project, the reader's grants, the address and the feedback.
 * Both are mounted here, once, so a screen module stays a screen module.
 *
 * The reads live here rather than in the adapter for a reason worth keeping:
 * the adapter is a value object over what has already been read, so a test
 * constructs one, while a hook cannot be constructed at all.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product
 * want it. This family reads it for one answer — which project the address is
 * about, and whether anything has ever been ingested into it, which is what the
 * overview page's setup prompt turns on.
 */

import { analyticsApi, AnalyticsHostProvider } from "@langwatch/analytics-web/screens/analytics";
import { useMemo, type ComponentType, type ReactNode } from "react";

import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { UiAnalyticsHost } from "../../behavior/analytics-host.adapter";

function AnalyticsHost({ children }: { children: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();

  const organizations = analyticsApi.organization.getAll.useQuery({ isDemo: false });

  /**
   * The project the address is about.
   *
   * Resolved from the one graph read rather than from a second query. Without a
   * project in scope every screen renders its empty shell, which is what the
   * platform pages did: every chart belongs to a project.
   */
  const project = useMemo(() => {
    if (!scope.projectId) return void 0;
    for (const organization of organizations.data ?? []) {
      for (const team of organization.teams) {
        const found = team.projects.find((candidate) => candidate.id === scope.projectId);
        if (found) {
          return {
            id: found.id,
            slug: found.slug,
            name: found.name,
            // The overview page leads with a setup prompt until the first
            // trace arrives, which is the one thing on these pages that is
            // about the project rather than about the range.
            hasFirstMessage: Boolean(found.firstMessage),
          };
        }
      }
    }
    return void 0;
  }, [organizations.data, scope.projectId]);

  const reading = route.reading();
  const host = useMemo(
    () =>
      UiAnalyticsHost.create(
        {
          project,
          organizationId: scope.organizationId ?? void 0,
          hasPermission: (permission: string) => session.hasPermission(permission),
          route: reading,
        },
        {
          setQuery: (next, options) => route.setQuery(next, options),
          navigate: (to) => navigation.navigate(to),
          succeeded: (notice) => feedback.succeeded(notice),
          failed: (failure) => feedback.failed(failure),
        },
      ),
    [project, scope.organizationId, session, reading, route, navigation, feedback],
  );

  return <AnalyticsHostProvider value={host}>{children}</AnalyticsHostProvider>;
}

/** Wraps an analytics screen in the host its package asks for. */
export function withAnalyticsHost<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  const Mounted = (props: P) => (
    <AnalyticsHost>
      <Screen {...props} />
    </AnalyticsHost>
  );
  Mounted.displayName = `withAnalyticsHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}
