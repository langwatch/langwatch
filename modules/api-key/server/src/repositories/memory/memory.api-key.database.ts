import type { StoredApiKey } from "../api-key.repository.ts";

/**
 * The rows the memory API-key repository reads. Held here rather than in the
 * repository so a test can seed the one thing the ApiKey table carries that a
 * key row does not: which owners have been deactivated.
 */
export class MemoryApiKeyDatabase {
  #keys: StoredApiKey[] = [];
  #deactivatedUserIds = new Set<string>();

  static create(): MemoryApiKeyDatabase {
    return new MemoryApiKeyDatabase();
  }

  keys(): StoredApiKey[] {
    return this.#keys;
  }

  replaceKey(key: StoredApiKey): void {
    const index = this.#keys.findIndex((row) => row.id === key.id);
    if (index === -1) this.#keys.push(key);
    else this.#keys[index] = key;
  }

  isUserDeactivated(userId: string | null): boolean {
    return userId !== null && this.#deactivatedUserIds.has(userId);
  }

  deactivateUser(userId: string): void {
    this.#deactivatedUserIds.add(userId);
  }
}
