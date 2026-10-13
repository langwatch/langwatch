// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The provider catalogue `ModelProviderApi` has no operation for: it lists
 * database-configured providers, never the static registry of definitions.
 * Reads the model-provider module's own contract package directly instead —
 * see `.claude/handoffs/gov-peer-ports.md` for the open decision.
 */
import { modelProviders } from "@langwatch/model-provider-contract";

import type { AiToolProviderCatalog } from "../repositories/ai-tool-catalog.repository.ts";

export class ModelProviderAiToolCatalogService implements AiToolProviderCatalog {
  private constructor() {}

  static create(): ModelProviderAiToolCatalogService {
    return new ModelProviderAiToolCatalogService();
  }

  findAll(): { providerKey: string; displayName: string; type: string }[] {
    return Object.entries(modelProviders).map(([providerKey, definition]) => ({
      providerKey,
      displayName: definition.name,
      type: definition.type,
    }));
  }
}
