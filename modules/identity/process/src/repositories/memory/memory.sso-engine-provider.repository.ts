import type { SsoEngineProviderRow } from "../../rules/sso-engine-provider.rules.ts";
import { SsoEngineProviderRepository } from "../sso-engine-provider.repository.ts";
import type { MemoryIdentityStore } from "./memory-identity.store.ts";

/** The engine's provider rows, held in the store. */
export class MemorySsoEngineProviderRepository extends SsoEngineProviderRepository {
  static create(store: MemoryIdentityStore): MemorySsoEngineProviderRepository {
    return new MemorySsoEngineProviderRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {
    super();
  }

  async put(row: SsoEngineProviderRow): Promise<void> {
    this.store.ssoEngineProviders.set(row.id, row);
  }

  async remove({ connectionId }: { connectionId: string }): Promise<void> {
    this.store.ssoEngineProviders.delete(connectionId);
  }
}
