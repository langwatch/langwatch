import { modelProviderRegistry } from "./registry";
import type { ModelProviderSpec, ModelProviderSurface } from "./types";

/**
 * The providers this surface offers, in the order this surface wants:
 * providers the surface recommends lead (badged), the rest keep registry
 * order, and providers the surface must not offer are gone entirely.
 *
 * The one availability rule every provider picker applies, the model
 * provider grid and the guided takeover's marks row alike, so two pickers
 * on the same install cannot disagree about which providers exist.
 */
export function providersForSurface(
  variant: ModelProviderSurface,
): ModelProviderSpec[] {
  const offered = modelProviderRegistry.filter(
    (mp) => !mp.hiddenOn?.includes(variant),
  );
  return [
    ...offered.filter((mp) => mp.recommendedOn?.includes(variant)),
    ...offered.filter((mp) => !mp.recommendedOn?.includes(variant)),
  ];
}
