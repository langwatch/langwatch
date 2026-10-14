/** Pure edits of the workbench's targets, which the store applies. */
import {
  type ComparisonEvaluatorConfig,
  deriveComparisonTargetMappings,
  inferAllEvaluatorMappings,
  propagateMappingsToNewDataset,
} from "@langwatch/experiment-contract";

import {
  type EvaluationsV3State,
  type FieldMapping,
  isComparisonEvaluator,
  type TargetConfig,
} from "./types.ts";

/** A target's mappings without the inputs it no longer declares (removal only; no auto-mapping). */
const mappingsWithoutInputs = ({
  mappings,
  removedInputIds,
}: {
  mappings: TargetConfig["mappings"];
  removedInputIds: string[];
}): TargetConfig["mappings"] =>
  Object.fromEntries(
    Object.entries(mappings).map(([datasetId, datasetMappings]) => [
      datasetId,
      Object.fromEntries(
        Object.entries(datasetMappings).filter(([inputId]) => !removedInputIds.includes(inputId)),
      ),
    ]),
  );

/** One target updated; inputs it drops take their mappings with them. */
export const withTargetUpdate = ({
  state,
  targetId,
  updates,
}: {
  state: EvaluationsV3State;
  targetId: string;
  updates: Partial<TargetConfig>;
}): Partial<EvaluationsV3State> => {
  const existing = state.targets.find((r) => r.id === targetId);
  if (!existing) return state;

  const newInputIds = new Set(updates.inputs?.map((i) => i.identifier));
  const removedInputIds = updates.inputs
    ? (existing.inputs ?? []).map((i) => i.identifier).filter((id) => !newInputIds.has(id))
    : [];
  const finalUpdates =
    removedInputIds.length > 0
      ? {
          ...updates,
          mappings: mappingsWithoutInputs({ mappings: existing.mappings, removedInputIds }),
        }
      : updates;

  return {
    targets: state.targets.map((r) => (r.id === targetId ? { ...r, ...finalUpdates } : r)),
  };
};

/** The per-row mapping keys a comparison target derives from its variants and golden field. */
const DERIVED_KEYS = [
  "candidate_a_id",
  "candidate_a_output",
  "candidate_b_id",
  "candidate_b_output",
  "golden",
  "input",
];

/**
 * A comparison column-target's config, with the per-row mappings the
 * orchestrator reads re-derived for every dataset. Other targets are left alone.
 */
export const withTargetComparison = ({
  state,
  targetId,
  comparison,
}: {
  state: EvaluationsV3State;
  targetId: string;
  comparison: ComparisonEvaluatorConfig;
}): Partial<EvaluationsV3State> => {
  const existing = state.targets.find((r) => r.id === targetId);
  if (existing?.type !== "evaluator" || !isComparisonEvaluator(existing)) return state;

  const mappings: Record<string, Record<string, FieldMapping>> = Object.fromEntries(
    state.datasets.map((dataset) => {
      const kept = Object.fromEntries(
        Object.entries(existing.mappings[dataset.id] ?? {}).filter(
          ([key]) => !DERIVED_KEYS.includes(key),
        ),
      );
      return [dataset.id, { ...kept, ...deriveComparisonTargetMappings(comparison, dataset) }];
    }),
  );

  return {
    targets: state.targets.map((t) =>
      // Drop the legacy `pairwise` shape as the canonical one is written.
      t.id === targetId ? { ...t, pairwise: undefined, comparison, mappings } : t,
    ),
  };
};

/**
 * Every target and evaluator auto-mapped onto a newly added dataset: a field
 * mapped to a column elsewhere maps to the same-named column here. Arrays come
 * back unchanged (same reference) when nothing was mapped.
 */
export const withNewDatasetMappings = ({
  state,
  dataset,
}: {
  state: EvaluationsV3State;
  dataset: EvaluationsV3State["datasets"][number];
}): Pick<EvaluationsV3State, "targets" | "evaluators"> => {
  const mappedTargets = state.targets.map((target) => {
    const added = propagateMappingsToNewDataset(target.inputs, target.mappings, dataset);
    if (Object.keys(added).length === 0) return target;
    return {
      ...target,
      mappings: { ...target.mappings, [dataset.id]: { ...target.mappings[dataset.id], ...added } },
    };
  });
  const mappedEvaluators = state.evaluators.map((evaluator) => {
    const datasetMappings = inferAllEvaluatorMappings(evaluator, [dataset], mappedTargets)[
      dataset.id
    ];
    if (!datasetMappings || Object.keys(datasetMappings).length === 0) return evaluator;
    return { ...evaluator, mappings: { ...evaluator.mappings, [dataset.id]: datasetMappings } };
  });

  return {
    targets: mappedTargets.some((t, i) => t !== state.targets[i]) ? mappedTargets : state.targets,
    evaluators: mappedEvaluators.some((e, i) => e !== state.evaluators[i])
      ? mappedEvaluators
      : state.evaluators,
  };
};
