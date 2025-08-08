export interface CacheStore<T = unknown> {
  set(key: string, value: T, ttl?: number): Promise<void>;
  get(key: string): Promise<T | undefined>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
  size(): Promise<number>;
  cleanup(): Promise<void>;
}
