/**
 * The slice of a Redis client this package uses.
 *
 * Declared structurally rather than importing `ioredis`, so the package needs
 * no client dependency of its own, the app injects the connection it already
 * has, and a unit test injects a Map-backed fake without a container.
 *
 * Deliberately one `set` shape: an NX variant would need an overloaded
 * signature that real clients only sometimes satisfy, and every place that
 * wanted NX here is expressible as a one-slot counter instead.
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    expiryToken: "EX",
    seconds: number,
  ): Promise<unknown>;
  del(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
}

/** Everything this package writes lives under one prefix. */
export const KEY_PREFIX = "langwatch:ai-onboarding";
