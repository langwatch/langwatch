/** A stored entry the platform can no longer open (its key changed): the caller reads a miss. */
export class GatewayAgentCacheEntryUnreadableError extends Error {
  override readonly name = "GatewayAgentCacheEntryUnreadableError";

  constructor(options: { cause: unknown }) {
    super("The agent cache entry cannot be read back", { cause: options.cause });
  }
}

/** Entry values are readable here; the live repository seals them at rest. */
export interface GatewayAgentCacheEntryRepository {
  /** The entry's value, or undefined; `GatewayAgentCacheEntryUnreadableError` if it cannot open. */
  find(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  claim(key: string, value: string, ttlMs: number): Promise<boolean>;
  delete(key: string): Promise<void>;
}
