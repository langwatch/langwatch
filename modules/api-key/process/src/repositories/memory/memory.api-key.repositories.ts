import type { ApiKeyRepositories } from "../api-key.repositories.ts";
import { MemoryApiKeyDatabase } from "./memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "./memory.api-key.repository.ts";

/** The API-key aggregate with no datastore behind it, for a boot that needs none. */
export class MemoryApiKeyRepositories {
  static readonly requires = [] as const;

  static create(): ApiKeyRepositories {
    return { apiKeys: MemoryApiKeyRepository.create({ memory: MemoryApiKeyDatabase.create() }) };
  }
}
