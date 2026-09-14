/**
 * Validates which Redis methods the composition accesses at construction.
 * Empty results for test assertions; nothing executes.
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
