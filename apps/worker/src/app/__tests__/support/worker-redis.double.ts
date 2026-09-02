/**
 * The one Redis this process opens, as a composition-time double.
 *
 * WHY IT IS SHAPED RATHER THAN EMPTY. Several features check at CONSTRUCTION
 * that the connection they were handed can actually do what they need — the
 * GitHub branch cache wants `get`/`set`/`del`, the fold caches want `setex`,
 * the tenant broadcast wants `publish` — and refuse a graph composed against
 * something else. That check is deliberate: a worker wired to a non-Redis
 * should fail at boot, not on the first sweep.
 *
 * Nothing here executes anything real. Every method answers the empty result,
 * because these tests assert what was COMPOSED, never what it stored.
 */
export function createWorkerProcessRedis(overrides: object = {}) {
  return {
    get: async () => null,
    set: async () => "OK",
    setex: async () => "OK",
    del: async () => 0,
    exists: async () => 0,
    expire: async () => 0,
    incr: async () => 1,
    smembers: async () => [],
    sadd: async () => 0,
    srem: async () => 0,
    publish: async () => 0,
    subscribe: async () => 0,
    on: () => void 0,
    eval: async () => null,
    evalsha: async () => null,
    defineCommand: () => void 0,
    scan: async () => ["0", []],
    pipeline: () => ({ exec: async () => [] }),
    multi: () => ({ exec: async () => [] }),
    quit: async () => "OK",
    duplicate() {
      return createWorkerProcessRedis(overrides);
    },
    ...overrides,
  };
}
