/**
 * What the Workflows screens are mounted inside.
 *
 * Two things go around `/:project/workflows` and `/:project/chat/:workflow`:
 * the tRPC Provider the package's own hooks run on, and the host port that
 * answers for the project, the reader's grants, the replication targets, the
 * address, the feedback and the navigation into the studio. Both are mounted
 * here, once, so a screen module stays a screen module.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product
 * want it. This family reads the whole graph rather than one project, because
 * the replication picker offers every project the reader may create a workflow
 * in — and because the project SLUG, which both navigations need, is on it.
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
 * The grant a replication target is judged by.
 *
 * `useProjectsForCopy("workflows:create")` is what `CopyWorkflowDialog` asked
 * for, and it is the right question: replicating writes a NEW workflow into the
 * target project.
 */
const WORKFLOW_COPY_PERMISSION = "workflows:create";

export function WorkflowHost({
  children,
  copyPermission = WORKFLOW_COPY_PERMISSION,
}: {
  children: ReactNode;
  /**
   * The grant the replicate picker asks about, per family.
   *
   * Workflows ask `workflows:create`, because replicating writes a new workflow
   * into the target project. The EXPERIMENTS family mounts this same host — its
   * closure answers to `@langwatch/workflow-web/studio-host/*`, so a second port
   * would have split the tRPC cache — and its replicate dialog has always asked
   * `evaluations:manage`. One derivation, told which question to ask, rather
   * than two hosts over one page.
   */
  copyPermission?: string;
}) {
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
 * Wraps a screen in the workflow host its package asks for.
 *
 * NOT ONLY THE WORKFLOWS FAMILY'S. The experiments family and the legacy
 * online-evaluation edit form both moved with the studio slice, so their whole
 * closure — `experiments-v3`'s hooks, `CheckConfigForm` and everything under it
 * — reads `@langwatch/workflow-web/studio-host/*` for the project, the
 * transport, the router, the toasts and the errors. Mounting this host over
 * their screens is what makes those readings answer; mounting a second port of
 * their own would have split the tRPC cache and left `useTargetName` asking a
 * host nothing had mounted.
 *
 * KEPT AS A HOC, unlike its sibling families, because `experiments` and
 * `evaluations` — outside this fold's scope — still import it directly and
 * call it with a per-screen `copyPermission` override.
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
