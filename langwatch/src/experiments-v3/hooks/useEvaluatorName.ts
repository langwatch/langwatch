import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { EvaluatorConfig } from "../types";

/**
 * Batch-fetch display names for multiple evaluators.
 *
 * Resolution order per evaluator:
 *  1. localEvaluatorConfig.name  (unsaved local edit)
 *  2. DB name via evaluators.getById
 *  3. evaluator.id (fallback)
 *
 * Returns a stable Map<evaluatorConfigId, displayName>.
 */
export const useEvaluatorNames = (
  evaluators: EvaluatorConfig[],
): Map<string, string> => {
  const { project } = useOrganizationTeamProject();

  const queries = api.useQueries((t) =>
    evaluators.map((evaluator) =>
      t.evaluators.getById(
        {
          id: evaluator.dbEvaluatorId ?? "",
          projectId: project?.id ?? "",
        },
        {
          enabled: !!evaluator.dbEvaluatorId && !!project?.id,
          staleTime: 60_000,
        },
      ),
    ),
  );

  // Derive a cheap string key so useMemo only recomputes when names actually
  // change, not on every render (api.useQueries returns a new array ref).
  const namesKey = evaluators
    .map((ev, i) => {
      const name =
        ev.localEvaluatorConfig?.name ?? queries[i]?.data?.name ?? ev.id;
      return `${ev.id}:${name}`;
    })
    .join("|");

  return useMemo(() => {
    return new Map(
      evaluators.map((evaluator, index) => [
        evaluator.id,
        evaluator.localEvaluatorConfig?.name ??
          queries[index]?.data?.name ??
          evaluator.id,
      ]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey]);
};

/**
 * Hook to fetch the display name for a single evaluator.
 * Thin wrapper around useEvaluatorNames for single-evaluator consumers.
 */
export const useEvaluatorName = (evaluator: EvaluatorConfig): string => {
  const names = useEvaluatorNames([evaluator]);
  return names.get(evaluator.id) ?? evaluator.id;
};

/**
 * Returns the set of evaluator config ids whose database evaluator is a code
 * evaluator (DB `type === "code"`). Used to route their edit flow to the code
 * editor rather than the generic mapping editor.
 *
 * Reuses the same `getById` queries as the name lookup (same keys, shared
 * cache), so detection adds no extra requests and is ready by the time the
 * chip has rendered its name.
 */
export const useCodeEvaluatorIds = (
  evaluators: EvaluatorConfig[],
): Set<string> => {
  const { project } = useOrganizationTeamProject();

  const queries = api.useQueries((t) =>
    evaluators.map((evaluator) =>
      t.evaluators.getById(
        {
          id: evaluator.dbEvaluatorId ?? "",
          projectId: project?.id ?? "",
        },
        {
          enabled: !!evaluator.dbEvaluatorId && !!project?.id,
          staleTime: 60_000,
        },
      ),
    ),
  );

  const codeKey = evaluators
    .map((ev, i) => `${ev.id}:${queries[i]?.data?.type === "code" ? 1 : 0}`)
    .join("|");

  return useMemo(() => {
    return new Set(
      evaluators
        .filter((_ev, index) => queries[index]?.data?.type === "code")
        .map((ev) => ev.id),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeKey]);
};
