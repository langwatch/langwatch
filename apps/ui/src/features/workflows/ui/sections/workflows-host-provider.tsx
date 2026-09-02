/**
 * What the Workflows screens are mounted inside.
 *
 * Two things go around `/:project/workflows` and `/:project/chat/:workflow`:
 * the tRPC Provider the package's own hooks run on, and the host port that
 * answers for the project, the reader's grants, the replication targets, the
 * address, the feedback and the navigation into the studio. Both are mounted
 * here, once, so a screen module stays a screen module.
 *
 * The reads live here rather than in the adapter for a reason worth keeping:
 * the adapter is a value object over what has already been read, so a test
 * constructs one, while a hook cannot be constructed at all.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product
 * want it. This family reads the whole graph rather than one project, because
 * the replication picker offers every project the reader may create a workflow
 * in — and because the project SLUG, which both navigations need, is on it.
 */

import { workflowApi, WorkflowHostProvider } from "@langwatch/workflow-web/screens/workflows";
import { useMemo, type ComponentType, type ReactNode } from "react";

import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { uiCopyTargets } from "../../../../model/ui-copy-targets";
import { UiWorkflowHost, WORKFLOW_COPY_PERMISSION } from "../../behavior/workflows-host.adapter";

function WorkflowHost({ children }: { children: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();

  const organizations = workflowApi.organization.getAll.useQuery({ isDemo: false });

  /**
   * The project the address is about.
   *
   * Resolved from the one graph read rather than from a second query. Without a
   * project in scope the screens render their empty shells, which is what the
   * platform pages did: every workflow belongs to a project.
   */
  const project = useMemo(() => {
    if (!scope.projectId) {
      return {
        projectId: void 0,
        projectSlug: void 0,
        projectName: void 0,
        organizationId: void 0,
        teamId: void 0,
        isResolved: organizations.isFetched,
      };
    }
    for (const organization of organizations.data ?? []) {
      for (const team of organization.teams) {
        const found = team.projects.find((candidate) => candidate.id === scope.projectId);
        if (found) {
          return {
            projectId: found.id,
            projectSlug: found.slug,
            projectName: found.name,
            organizationId: organization.id,
            teamId: team.id,
            isResolved: true,
          };
        }
      }
    }
    return {
      projectId: scope.projectId,
      projectSlug: void 0,
      projectName: void 0,
      organizationId: scope.organizationId ?? void 0,
      teamId: void 0,
      isResolved: organizations.isFetched,
    };
  }, [organizations.data, organizations.isFetched, scope.projectId, scope.organizationId]);

  const copyTargets = useMemo(
    () =>
      uiCopyTargets({
        organizations: organizations.data ?? [],
        userId: session.currentUser()?.id,
        permission: WORKFLOW_COPY_PERMISSION,
      }),
    [organizations.data, session],
  );

  const reading = route.reading();
  /**
   * The studio's own router shim reads `pathname`, which the route capability
   * does not carry: `UiRouteReadingValues` is parameters and query only. The
   * address bar is the honest answer and the one the platform compat shim gave.
   */
  const routeReading = useMemo(
    () => ({
      ...reading,
      pathname: typeof window === "undefined" ? "" : window.location.pathname,
    }),
    [reading],
  );
  const host = useMemo(
    () =>
      UiWorkflowHost.create(
        {
          scope: project,
          hasPermission: (permission: string) => session.hasPermission(permission),
          copyTargets,
          route: routeReading,
        },
        {
          setQuery: (next, options) => route.setQuery(next, options),
          navigate: (to) => navigation.navigate(to),
          back: () => navigation.back(),
          succeeded: (notice) => feedback.succeeded(notice),
          failed: (failure) => feedback.failed(failure),
        },
      ),
    [project, session, copyTargets, routeReading, route, navigation, feedback],
  );

  return <WorkflowHostProvider value={host}>{children}</WorkflowHostProvider>;
}

/** Wraps a Workflows screen in the host its package asks for. */
export function withWorkflowHost<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  const Mounted = (props: P) => (
    <WorkflowHost>
      <Screen {...props} />
    </WorkflowHost>
  );
  Mounted.displayName = `withWorkflowHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}
