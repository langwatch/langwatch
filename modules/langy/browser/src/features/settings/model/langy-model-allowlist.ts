/**
 * The settings page's reading of the models Langy may use. An empty list allows every model.
 * Spec: specs/langy/langy-model-allowlist.feature
 */

/** Langy's default model is set but the list narrows Langy away from it. */
export function isDefaultModelOutsideList({
  defaultModel,
  models,
}: {
  defaultModel: string | null | undefined;
  models: readonly string[];
}): boolean {
  return !!defaultModel && models.length > 0 && !models.includes(defaultModel);
}
