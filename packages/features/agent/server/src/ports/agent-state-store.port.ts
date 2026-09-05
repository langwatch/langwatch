/**
 * The small key, sorted-set, hash and pub/sub surface connected agents need
 * (ADR-128).
 */

export type Unsubscribe = () => Promise<void>;

export abstract class AgentStateStorePort {
  /** Whether this store is shared between app replicas. */
  abstract readonly shared: boolean;
  abstract set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** SET NX: writes only when the key is absent; resolves to whether it wrote. */
  abstract setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  abstract tryGet(key: string): Promise<string | null>;
  abstract del(key: string): Promise<void>;
  abstract zadd(params: {
    key: string;
    score: number;
    member: string;
    ttlSeconds: number;
  }): Promise<void>;
  /** ZADD XX LT: lowers the score of a present member, never raises it. */
  abstract zaddLowerIfPresent(key: string, score: number, member: string): Promise<void>;
  abstract zrem(key: string, member: string): Promise<void>;
  abstract zremrangebyscore(key: string, max: number): Promise<void>;
  /** Members with a score at or above `min`, in score order. */
  abstract zrangebyscore(key: string, min: number): Promise<string[]>;
  abstract hset(key: string, fields: Record<string, string>, ttlSeconds: number): Promise<void>;
  abstract tryHgetall(key: string): Promise<Record<string, string> | null>;
  abstract incr(key: string, ttlSeconds: number): Promise<number>;
  abstract decr(key: string): Promise<number>;
  /** Publishes; resolves to how many subscribers received it. */
  abstract publish(channel: string, message: string): Promise<number>;
  abstract subscribe(channel: string, handler: (message: string) => void): Promise<Unsubscribe>;
  abstract close(): Promise<void>;
}
