/**
 * Single source of truth for the model catalog. Merges the base
 * `llmModels.json` (regenerated periodically from the upstream model
 * source) with the hand-curated `llmModels.overlay.json` so direct-API
 * providers whose models aren't in the upstream catalog (Voyage today,
 * additions later) stay in the registry across regenerations.
 *
 * Merge rule: the base catalog wins on key collision. If the upstream
 * source ever starts carrying a model that the overlay also has, the
 * regen-side entry takes precedence automatically (it has authoritative
 * pricing + context-length) and the overlay shadow becomes a no-op
 * without a code change. The overlay only fills gaps.
 *
 * The regen task is not aware of and never writes the overlay file —
 * keep it that way.
 */
import * as llmModelsRaw from "./llmModels.json";
import * as llmModelsOverlayRaw from "./llmModels.overlay.json";
import type { LLMModelEntry, LLMModelRegistry } from "./llmModels.types";

const base = llmModelsRaw as unknown as LLMModelRegistry;
const overlay = llmModelsOverlayRaw as unknown as {
  models: Record<string, LLMModelEntry>;
};

// Overlay first, base second so base wins on collision.
const mergedModels: Record<string, LLMModelEntry> = {
  ...overlay.models,
  ...base.models,
};

/** Merged model catalog ready for callers. Same shape as the base
 *  `llmModels.json` but with overlay entries folded in. */
export const llmModels: LLMModelRegistry = {
  updatedAt: base.updatedAt,
  modelCount: Object.keys(mergedModels).length,
  models: mergedModels,
};
