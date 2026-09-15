/** Redis operations replay markers and queue draining require. */
export interface ReplayRedisPipeline {
  hset(key: string, field: string, value: string): ReplayRedisPipeline;
  hdel(key: string, ...fields: string[]): ReplayRedisPipeline;
  sadd(key: string, ...members: string[]): ReplayRedisPipeline;
  smembers(key: string): ReplayRedisPipeline;
  get(key: string): ReplayRedisPipeline;
  set(key: string, value: string, expiry: "EX", seconds: number): ReplayRedisPipeline;
  expire(key: string, seconds: number): ReplayRedisPipeline;
  exec(): Promise<readonly [Error | null, unknown][] | null>;
}

/** The replay's named Redis substrate, implemented by standalone and Cluster clients. */
export interface ReplayRedis {
  pipeline(): ReplayRedisPipeline;
  smembers(key: string): Promise<string[]>;
  hgetall(key: string): Promise<Record<string, string>>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  del(...keys: string[]): Promise<number>;
  scard(key: string): Promise<number>;
  hlen(key: string): Promise<number>;
  scan(cursor: string, ...args: (string | number)[]): Promise<[string, string[]]>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  lpush(key: string, ...values: string[]): Promise<number>;
}
