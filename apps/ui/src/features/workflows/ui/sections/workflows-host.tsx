/**
 * What the Workflows screens mount inside: the tRPC Provider, and the host
 * port for project, grants, replication targets, address, feedback and
 * studio navigation — whole graph read, since replication targets any project.
 */

import {
  workflowApi,
  WorkflowHostProvider,
  type WorkflowHostPort,
} from "@langwatch/workflow-web/screens/workflows";
import { useMemo, type ComponentType, type ReactNode } from "react";

import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { uiCopyTargets } from "../../../../model/ui-copy-targets";

/**
 * The grant a replication target is judged by: `workflows:create`, since
 * replicating writes a NEW workflow into the target project.
 */
const WORKFLOW_COPY_PERMISSION = "workflows:create";

export function WorkflowHost({
  children,
  copyPermission = WORKFLOW_COPY_PERMISSION,
}: {
  children: ReactNode;
  /**
   * The grant the replicate picker asks about, per family — the experiments
   * family mounts this same host (one port, so the tRPC cache doesn't split)
   * and asks `evaluations:manage` instead.
   */
  copyPermission?: string;
}) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();

  const organizations = workflowApi.organization.getAll.useQuery({ isDemo: false });

  /** The project the address is about — from the one graph read rather than a second query. */
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
        permission: copyPermission,
      }),
    [organizations.data, session, copyPermission],
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
  const host = useMemo<WorkflowHostPort>(
    () => ({
      scope: () => project,
      hasPermission: (permission: string) => session.hasPermission(permission),
      copyTargets: () => copyTargets,
      route: () => routeReading,
      setQuery: (next, options) => route.setQuery(next, options),
      navigate: (to) => navigation.navigate(to),
      back: () => navigation.back(),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
    }),
    [project, session, copyTargets, routeReading, route, navigation, feedback],
  );

  return <WorkflowHostProvider value={host}>{children}</WorkflowHostProvider>;
}

/**
 * Wraps a screen in the workflow host its package asks for — shared by
 * experiments and the legacy online-evaluation form too (one host, so the
 * tRPC cache doesn't split); kept as a HOC since both call it directly.
 */
export function withWorkflowHost<P extends object>(
  Screen: ComponentType<P>,
  options: { copyPermission?: string } = {},
): ComponentType<P> {
  const Mounted = (props: P) => (
    <WorkflowHost {...(options.copyPermission ? { copyPermission: options.copyPermission } : {})}>
      <Screen {...props} />
    </WorkflowHost>
  );
  Mounted.displayName = `withWorkflowHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}

export { workflowApi };
