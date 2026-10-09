/**
 * Translates a legacy 2-slot pairwise payload (`candidate_a_id` /
 * `candidate_a_output` / ... `candidate_b_*`) into the N-way `candidates` shape
 * `langevals/select_best_compare` expects.
 */
export const translateLegacyPairwisePayload = (
  data: Record<string, unknown>,
): Record<string, unknown> => {
  const {
    candidate_a_id,
    candidate_a_output,
    candidate_a_cost,
    candidate_a_duration,
    candidate_b_id,
    candidate_b_output,
    candidate_b_cost,
    candidate_b_duration,
    ...rest
  } = data;

  const candidates = [
    candidate_a_id !== undefined
      ? {
          id: candidate_a_id,
          output: candidate_a_output,
          cost: candidate_a_cost,
          duration: candidate_a_duration,
        }
      : undefined,
    candidate_b_id !== undefined
      ? {
          id: candidate_b_id,
          output: candidate_b_output,
          cost: candidate_b_cost,
          duration: candidate_b_duration,
        }
      : undefined,
  ].filter((candidate) => candidate !== undefined);

  return { ...rest, candidates };
};

/**
 * Removes a legacy pairwise `prompt` that select_best_compare cannot render:
 * the N-way judge substitutes only `{candidates}`, `{input}` and `{golden}`.
 */
export const stripIncompatiblePairwisePrompt = (
  settings: Record<string, unknown>,
): { settings: Record<string, unknown>; droppedPrompt: boolean } => {
  if (typeof settings.prompt === "string" && !settings.prompt.includes("{candidates}")) {
    const { prompt: _incompatible, ...rest } = settings;

    return { settings: rest, droppedPrompt: true };
  }

  return { settings, droppedPrompt: false };
};
