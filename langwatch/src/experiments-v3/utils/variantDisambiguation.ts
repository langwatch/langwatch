export type DisambiguatedVariantNames = {
  variantAName: string;
  variantBName: string;
};

/**
 * Pairwise variant A/B display names are only distinct because callers
 * happen to pick differently-named prompts. When both variants resolve to
 * the same name (e.g. the same prompt run twice against different models),
 * the scoreboard/verdict UI otherwise renders two identical labels with no
 * way to tell which is which (#5502-adjacent customer feedback, 2026-07-08).
 *
 * Disambiguates using the model, since that's the differentiator in the
 * common case; falls back to a plain "(1)"/"(2)" suffix when the models
 * also match (or aren't known) so the two are still distinguishable.
 */
export const disambiguateVariantNames = (
  variantAName: string,
  variantBName: string,
  variantAModel?: string,
  variantBModel?: string,
): DisambiguatedVariantNames => {
  if (!variantAName || variantAName !== variantBName) {
    return { variantAName, variantBName };
  }

  if (variantAModel && variantBModel && variantAModel !== variantBModel) {
    return {
      variantAName: `${variantAName} (${variantAModel})`,
      variantBName: `${variantBName} (${variantBModel})`,
    };
  }

  return {
    variantAName: `${variantAName} (1)`,
    variantBName: `${variantBName} (2)`,
  };
};
