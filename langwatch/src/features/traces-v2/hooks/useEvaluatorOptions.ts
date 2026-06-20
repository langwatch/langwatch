import { useMemo } from "react";
import { useTraceFacets } from "./useTraceFacets";

export interface EvaluatorOption {
  /** Evaluator id (the value persisted in an eval column key). */
  value: string;
  /** Evaluator display name, falling back to the id. */
  label: string;
}

/**
 * Evaluators observed in the active time range, sourced from the shared
 * `discover` "evaluator" facet (no extra request). `options` drives the
 * eval-column picker; `nameByKey` resolves evaluator ids to names for
 * column headers and picker entries. Evaluators with no runs in range
 * simply don't appear — the user can still type a free-text key, and a
 * key with no matching runs renders an all-dash column.
 */
export function useEvaluatorOptions(): {
  options: EvaluatorOption[];
  nameByKey: Map<string, string>;
} {
  const { data } = useTraceFacets();

  return useMemo(() => {
    const options: EvaluatorOption[] = [];
    const nameByKey = new Map<string, string>();
    const facet = data?.find((f) => f.key === "evaluator");
    if (facet && facet.kind === "categorical") {
      for (const tv of facet.topValues) {
        const label = tv.label || tv.value;
        options.push({ value: tv.value, label });
        nameByKey.set(tv.value, label);
      }
    }
    return { options, nameByKey };
  }, [data]);
}
