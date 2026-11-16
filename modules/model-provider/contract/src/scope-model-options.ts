/**
 * What a Default models config on some scopes may pick for its chat and embedding roles.
 * @see modules/model-provider/specs/default-models-scope-model-options.feature
 */
import type { Named } from "@langwatch/module";
import { z } from "zod";

import { modelSelectorOptions } from "./model-options.ts";

const emptyScopeProviderSchemaDefinition = z.object({
  id: z.string(),
  provider: z.string(),
  name: z.string(),
  /** Read from the server's environment: no stored row to open, only the provider key. */
  isSystem: z.boolean(),
});
export interface EmptyScopeProviderSchema extends Named<
  typeof emptyScopeProviderSchemaDefinition
> {}
export const emptyScopeProviderSchema: EmptyScopeProviderSchema =
  emptyScopeProviderSchemaDefinition;
export type EmptyScopeProvider = z.infer<typeof emptyScopeProviderSchema>;

const scopeModelOptionsSchemaDefinition = z.object({
  /** Chat model ids every picked scope runs, aliases first, then custom, then catalogue. */
  chat: z.array(z.string()),
  embedding: z.array(z.string()),
  /** Custom model display names, keyed by `<provider>/<modelId>`. */
  displayNames: z.record(z.string(), z.string()),
  /** Enabled providers that list only the models added to them and hold none of that kind. */
  emptyProviders: z.object({
    chat: z.array(emptyScopeProviderSchema),
    embedding: z.array(emptyScopeProviderSchema),
  }),
});
export interface ScopeModelOptionsSchema extends Named<typeof scopeModelOptionsSchemaDefinition> {}
export const scopeModelOptionsSchema: ScopeModelOptionsSchema = scopeModelOptionsSchemaDefinition;
export type ScopeModelOptions = z.infer<typeof scopeModelOptionsSchema>;

export const NO_SCOPE_MODEL_OPTIONS: ScopeModelOptions = {
  chat: [],
  embedding: [],
  displayNames: {},
  emptyProviders: { chat: [], embedding: [] },
};

/** The catalogue's model ids for one provider and kind, as `<provider>/<model>`. */
export function catalogueModelIdsFor({
  provider,
  mode,
}: {
  provider: string;
  mode: "chat" | "embedding";
}): string[] {
  return modelSelectorOptions
    .filter((option) => option.mode === mode && option.value.split("/")[0] === provider)
    .map((option) => option.value);
}

/** True when the catalogue lists nothing for the provider: it offers only what is added (Azure). */
export function listsOnlyAddedModels({ provider }: { provider: string }): boolean {
  return (
    catalogueModelIdsFor({ provider, mode: "chat" }).length === 0 &&
    catalogueModelIdsFor({ provider, mode: "embedding" }).length === 0
  );
}
