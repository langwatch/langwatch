/**
 * Single source of truth for the model catalog. Merges the base
 * `llmModels.json`, regenerated weekly from the upstream price sources, with
 * the hand-curated `llmModels.overlay.json`.
 *
 * Merge rule: the overlay wins on key collision. It is the correction lane,
 * so a hand-written rate has to be able to override a wrong generated one.
 * The rule used to be the other way around, which made the overlay unable to
 * do the one job it existed for: an upstream source that carries a model at
 * the wrong price shadowed the hand-written fix, and no comment in the
 * overlay could change that. It went unnoticed for as long as every overlay
 * entry happened to be a model the base file did not carry.
 *
 * The cost of this direction is that a stale overlay entry now overrides a
 * corrected upstream price instead of quietly losing to it. That is why the
 * weekly sync audits every overlay entry against upstream and fails on a
 * disagreement it has not already accepted: an override has to keep earning
 * its place. Never take the audit out and leave this merge order in.
 *
 * The regen task never writes the overlay file. Keep it that way.
 */
import * as llmModelsRaw from "./llmModels.json";
import * as llmModelsOverlayRaw from "./llmModels.overlay.json";
import type { LLMModelEntry, LLMModelRegistry } from "./llmModels.types";

const base = llmModelsRaw as unknown as LLMModelRegistry;
const overlay = llmModelsOverlayRaw as unknown as {
  models: Record<string, LLMModelEntry>;
};

// Base first, overlay second so the hand-written correction wins.
const mergedModels: Record<string, LLMModelEntry> = {
  ...base.models,
  ...overlay.models,
};

/** Merged model catalog ready for callers. Same shape as the base
 *  `llmModels.json` but with overlay entries folded in. */
export const llmModels: LLMModelRegistry = {
  updatedAt: base.updatedAt,
  modelCount: Object.keys(mergedModels).length,
  models: mergedModels,
};

/** Ids the overlay overrides in the base catalog. The weekly price audit
 *  reports these so an override that is no longer needed gets retired. */
export const overlayOverriddenModelIds: string[] = Object.keys(overlay.models)
  .filter((id) => id in base.models)
  .sort();
