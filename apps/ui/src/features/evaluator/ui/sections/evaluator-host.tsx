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

import { useUiCapabilities } from "@langwatch/ui-host/capabilities";
import { useUiShellFailure } from "../../../../behavior/ui-shell-failure";
import { uiCopyTargets } from "../../../../model/ui-copy-targets";
import { UiPageFailure, UiPageLoading } from "../../../../ui/elements/ui-page-fallbacks";
import { overlayQuery } from "../../behavior/evaluator-overlay-address";

/** The grant a replication target is judged by. Evaluators live under evaluations. */
const EVALUATOR_COPY_PERMISSION = "evaluations:manage";

export function EvaluatorHost({ children }: { children: ReactNode }) {
  const { session, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();

  const organizations = evaluatorApi.organization.getAll.useQuery({ isDemo: false });

  // A refused graph is a state, not an empty one: `project` below is read
  // off this query, so a refusal left the evaluators screen empty forever.
  const failure = useUiShellFailure({
    error: organizations.error,
    fallbackTitle: "Couldn't load your evaluators",
  });

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

  if (failure.departing) return <UiPageLoading />;
  if (failure.copy) return <UiPageFailure copy={failure.copy} />;

  return <EvaluatorHostProvider value={host}>{children}</EvaluatorHostProvider>;
}
