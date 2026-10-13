import { GatewayProviderLabelRepository } from "../gateway-provider-label.repository.ts";
import type { MemoryGatewayStore } from "./memory.gateway.store.ts";

/** A provider's display label per budget provider key, from the store's seeded providers. */
export class MemoryGatewayProviderLabelRepository extends GatewayProviderLabelRepository {
  static create(store: MemoryGatewayStore): MemoryGatewayProviderLabelRepository {
    return new MemoryGatewayProviderLabelRepository(store);
  }

  private constructor(private readonly store: MemoryGatewayStore) {
    super();
  }

  async resolveProviderLabels(
    budgets: { providerKey: string | null }[],
  ): Promise<Map<string, string>> {
    const keys = new Set(budgets.map((budget) => budget.providerKey).filter((key) => key !== null));

    return new Map(
      this.store.modelProviders
        .filter((provider) => keys.has(provider.id))
        .map((provider) => [provider.id, provider.name || provider.provider]),
    );
  }
}
