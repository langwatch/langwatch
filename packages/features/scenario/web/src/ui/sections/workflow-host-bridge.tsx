/**
 * The workflow host, answered from this family's own.
 *
 * `@langwatch/analytics-web/components/PeriodSelector` is the time-range
 * control the run board and Agent Testing both draw, and it reads and writes
 * the address through `@langwatch/workflow-web/studio-host/next-router` —
 * which asks for a `WorkflowHostPort`. Nothing on this page is the studio, and
 * nothing about the control is: it needs an ADDRESS, and the workflow host is
 * simply the port the analytics package happened to be published against.
 *
 * So this bridges rather than duplicates. Everything below reads this family's
 * own host through the same compat router the rest of the package uses, which
 * is what keeps a test that mocks `behavior/next-router` mocking one router
 * rather than two.
 *
 * WHAT IS DELIBERATELY INERT: `copyTargets` (the studio's replicate dialog),
 * `back` (the studio's drawer stack) and the two notices, which this family
 * reports through its own feedback seam. Nothing the period control does
 * reaches any of them.
 */

import {
  WorkflowHostPort,
  WorkflowHostProvider,
  type WorkflowCopyTarget,
  type WorkflowFailureNotice,
  type WorkflowRouteReading,
  type WorkflowScope,
  type WorkflowSuccessNotice,
} from "@langwatch/workflow-web/model/workflow-host";
import { useMemo, type ReactNode } from "react";

import { showErrorToast } from "../../behavior/errors";
import { useRouter } from "../../behavior/next-router";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project";

type Reading = {
  scope: WorkflowScope;
  route: WorkflowRouteReading;
  navigate: (to: string) => void;
  setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
};

class ScenarioWorkflowHost extends WorkflowHostPort {
  constructor(private readonly reading: Reading) {
    super();
  }

  scope(): WorkflowScope {
    return this.reading.scope;
  }

  hasPermission(): boolean {
    return true;
  }

  copyTargets(): readonly WorkflowCopyTarget[] {
    return [];
  }

  route(): WorkflowRouteReading {
    return this.reading.route;
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.reading.setQuery(next, options);
  }

  navigate(to: string): void {
    this.reading.navigate(to);
  }

  back(): void {
    // The period control never navigates back.
  }

  succeeded(_notice: WorkflowSuccessNotice): void {
    // Nothing below this bridge reports a success.
  }

  failed(failure: WorkflowFailureNotice): void {
    showErrorToast(failure);
  }
}

/** Mounts the bridge above a screen that draws the period control. */
export function ScenarioWorkflowHostBridge({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { project, organization, team, isLoading } = useOrganizationTeamProject();

  const host = useMemo(() => {
    const query: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(router.query)) {
      query[key] = Array.isArray(value) ? value[0] : value;
    }
    return new ScenarioWorkflowHost({
      scope: {
        projectId: project?.id,
        projectSlug: project?.slug,
        projectName: project?.name,
        organizationId: organization?.id,
        teamId: team?.id,
        isResolved: !isLoading,
      },
      route: { params: query, query, pathname: router.pathname },
      navigate: (to) => router.push(to),
      setQuery: (next, options) =>
        router.push({ pathname: router.pathname, query: { ...query, ...next } }, undefined, {
          replace: options?.replace ?? false,
        }),
    });
  }, [router, project, organization, team, isLoading]);

  return <WorkflowHostProvider value={host}>{children}</WorkflowHostProvider>;
}
