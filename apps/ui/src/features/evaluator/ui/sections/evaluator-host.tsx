/**
 * What the evaluators screen is mounted inside.
 *
 * Two things go around `/:project/evaluators`: the tRPC Provider the package's
 * own hooks run on, and the host port that answers for the project, the
 * reader's grants, the replication targets, the address and the feedback. Both
 * are mounted here, once, so a screen module stays a screen module.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product
 * want it. This family reads the whole graph rather than one project, because
 * the replication picker offers every project in every organization the reader
 * belongs to.
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

  /**
   * The project the address is about.
   *
   * Resolved from the one graph read rather than from a second query. Without a
   * project in scope the screen renders its empty shell, which is what the
   * platform page did: every evaluator belongs to a project.
   */
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
