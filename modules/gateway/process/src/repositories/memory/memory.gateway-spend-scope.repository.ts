import { GatewaySpendScopeRepository } from "../gateway-spend-scope.repository.ts";
import type { MemoryGatewayStore } from "./memory.gateway.store.ts";

/** The organization's key ids behind the external ids a spend filter names. */
export class MemoryGatewaySpendScopeRepository extends GatewaySpendScopeRepository {
  static create(store: MemoryGatewayStore): MemoryGatewaySpendScopeRepository {
    return new MemoryGatewaySpendScopeRepository(store);
  }

  private constructor(private readonly store: MemoryGatewayStore) {
    super();
  }

  async findVirtualKeyIdsForExternalIds(input: {
    organizationId: string;
    externalIds: string[];
  }): Promise<string[]> {
    const externalIds = new Set(input.externalIds);

    return [...this.store.virtualKeys.values()]
      .filter(
        (key) =>
          key.organizationId === input.organizationId &&
          key.externalId !== null &&
          externalIds.has(key.externalId),
      )
      .map((key) => key.id);
  }
}
