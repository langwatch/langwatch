/**
 * Shared test factories for the custom-model display-name test files.
 *
 * Centralizes `makeProvider` so every file that builds provider-row
 * fixtures — the resolver's concern-split test files and
 * `customModelDisplayNames.unit.test.ts` — derives them from one
 * definition rather than copies that can drift apart.
 */
import type { MaybeStoredModelProvider } from "../registry";

/**
 * Builds a `MaybeStoredModelProvider` fixture with every optional column
 * nulled and the row enabled, so a test spells out only the fields whose
 * effect it means to exercise.
 */
export const makeProvider = (
  overrides: Partial<MaybeStoredModelProvider> & { provider: string },
): MaybeStoredModelProvider => ({
  enabled: true,
  customKeys: null,
  models: null,
  embeddingsModels: null,
  customModels: null,
  customEmbeddingsModels: null,
  deploymentMapping: null,
  extraHeaders: null,
  ...overrides,
});
