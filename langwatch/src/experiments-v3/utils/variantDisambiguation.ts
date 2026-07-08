export type DisambiguatedVariantNames = {
  variantAName: string;
  variantBName: string;
};

/**
 * Pairwise variant A/B display names are only distinct because callers
 * happen to pick differently-named prompts. When both variants resolve to
 * the same name (e.g. the same prompt run twice with a different config),
 * the scoreboard/verdict UI otherwise renders two identical labels with no
 * way to tell which is which (#5502-adjacent customer feedback, 2026-07-08).
 *
 * What actually differs between two same-name variants isn't always the
 * model — it could be temperature, a prompt edit, or anything else — so
 * this doesn't try to guess a differentiator. It appends a plain "(1)"/"(2)"
 * suffix; the rendered comparison view separately lets you click a variant
 * name to highlight its source column.
 */
export const disambiguateVariantNames = ({
  variantAName,
  variantBName,
}: {
  variantAName: string;
  variantBName: string;
}): DisambiguatedVariantNames => {
  if (!variantAName || variantAName !== variantBName) {
    return { variantAName, variantBName };
  }

  return {
    variantAName: `${variantAName} (1)`,
    variantBName: `${variantBName} (2)`,
  };
};
