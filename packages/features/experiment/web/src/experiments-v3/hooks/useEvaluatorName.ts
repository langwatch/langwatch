import { useMemo } from "react";
import { useOrganizationTeamProject } from "@langwatch/workflow-web/studio-host/use-organization-team-project";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "@langwatch/evaluator-contract";
import { api } from "@langwatch/workflow-web/studio-host/api";
import type { EvaluatorConfig } from "../types";

/**
 * What an evaluator with no stored name is called: the catalog's name for its
 * type, and the type itself for a project's own evaluators, whose
 * `custom/<id>` and `code/<id>` types the catalog has no entry for.
 *
 * The same order the get-state projection answers in, so the page and the
 * agent read one name for one evaluator.
 */
const typeName = (evaluator: EvaluatorConfig): string =>
  AVAILABLE_EVALUATORS[evaluator.evaluatorType as EvaluatorTypes]?.name ??
  evaluator.evaluatorType;

/**
 * What one evaluator is called, in order:
 *  1. the name the workbench holds
 *  2. the name of the database evaluator it points at
 *  3. the name of its type
 *
 * The config id is not in that list. It was the last step until an evaluator
 * arrived carrying neither a workbench name nor a database evaluator, which is
 * what the add-evaluator action produced, and three chips on one row read
 * `evaluator_AzPF-HSd`, `evaluator_E27nxt8l` and `evaluator_I72w-XB4`. A type
 * name is a worse name than the one its author should have given it, and a far
 * better one than an id.
 *
 * A name is a name only when it holds a character: a stored empty string is
 * absence, not a name, and reads as a blank chip.
 */
export const resolveEvaluatorName = ({
  evaluator,
  dbName,
}: {
  evaluator: EvaluatorConfig;
  dbName?: string | null;
}): string =>
  evaluator.localEvaluatorConfig?.name?.trim() ||
  dbName?.trim() ||
  typeName(evaluator);

/**
 * Batch-fetch display names for multiple evaluators.
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
    .map(
      (ev, i) =>
        `${ev.id}:${resolveEvaluatorName({ evaluator: ev, dbName: queries[i]?.data?.name })}`,
    )
    .join("|");

  return useMemo(() => {
    return new Map(
      evaluators.map((evaluator, index) => [
        evaluator.id,
        resolveEvaluatorName({
          evaluator,
          dbName: queries[index]?.data?.name,
        }),
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
  return names.get(evaluator.id) ?? resolveEvaluatorName({ evaluator });
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
