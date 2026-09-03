/**
 * What the evaluators screen is mounted inside: the tRPC Provider its hooks
 * run on, and the host port for project, grants, replication targets,
 * address and feedback.
 */

import {
  evaluatorApi,
  EvaluatorHostProvider,
  type EvaluatorHostPort,
} from "@langwatch/evaluator-web/screens/evaluators";
import { useMemo, type ReactNode } from "react";

import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { uiCopyTargets } from "../../../../model/ui-copy-targets";
import { overlayQuery } from "../../behavior/evaluator-overlay-address";

/** The grant a replication target is judged by. Evaluators live under evaluations. */
const EVALUATOR_COPY_PERMISSION = "evaluations:manage";

export function EvaluatorHost({ children }: { children: ReactNode }) {
  const { session, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();

  const organizations = evaluatorApi.organization.getAll.useQuery({ isDemo: false });

  /** The project the address is about, resolved from the one graph read rather than a second query. */
  const project = useMemo(() => {
    if (!scope.projectId) return { projectId: void 0, projectSlug: void 0 };
    for (const organization of organizations.data ?? []) {
      for (const team of organization.teams) {
        const found = team.projects.find((candidate) => candidate.id === scope.projectId);
        if (found) return { projectId: found.id, projectSlug: found.slug };
      }
    }
    return { projectId: scope.projectId, projectSlug: void 0 };
  }, [organizations.data, scope.projectId]);

  const copyTargets = useMemo(
    () =>
      uiCopyTargets({
        organizations: organizations.data ?? [],
        userId: session.currentUser()?.id,
        permission: EVALUATOR_COPY_PERMISSION,
      }),
    [organizations.data, session],
  );

  const reading = route.reading();
  const host = useMemo<EvaluatorHostPort>(
    () => ({
      scope: () => project,
      hasPermission: (permission) => session.hasPermission(permission),
      copyTargets: () => copyTargets,
      route: () => reading,
      setQuery: (next, options) => route.setQuery(next, options),
      openOverlay: (request) => route.setQuery({ ...reading.query, ...overlayQuery(request) }),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
    }),
    [project, session, copyTargets, reading, route, feedback],
  );

  return <EvaluatorHostProvider value={host}>{children}</EvaluatorHostProvider>;
}
