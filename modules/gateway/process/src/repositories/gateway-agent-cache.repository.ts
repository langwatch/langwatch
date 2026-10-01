export interface GatewayAgentCacheEntryRepository {
  find(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  claim(key: string, value: string, ttlMs: number): Promise<boolean>;
  delete(key: string): Promise<void>;
}
