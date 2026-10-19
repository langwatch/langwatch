export type Unsubscribe = () => Promise<void>;

export interface SessionStateStore {
  /** Whether this store is shared between app replicas. */
  readonly shared: boolean;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** SET NX: writes only when the key is absent; resolves to whether it wrote. */
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  /** Atomically creates or renews a claim only when its value is absent or unchanged. */
  setIfAbsentOrEqual(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  tryGet(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
  zadd(params: { key: string; score: number; member: string; ttlSeconds: number }): Promise<void>;
  /** ZADD XX LT: lowers the score of a present member, never raises it. */
  zaddLowerIfPresent(key: string, score: number, member: string): Promise<void>;
  zrem(key: string, member: string): Promise<void>;
  zremrangebyscore(key: string, max: number): Promise<void>;
  /** Members with a score at or above `min`, in score order. */
  zrangebyscore(key: string, min: number): Promise<string[]>;
  hset(key: string, fields: Record<string, string>, ttlSeconds: number): Promise<void>;
  tryHgetall(key: string): Promise<Record<string, string> | null>;
  incr(key: string, ttlSeconds: number): Promise<number>;
  decr(key: string): Promise<number>;
  /** Publishes; resolves to how many subscribers received it. */
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, handler: (message: string) => void): Promise<Unsubscribe>;
  close(): Promise<void>;
}
