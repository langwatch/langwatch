// ---------------------------------------------------------------------------
// Adapters — the outward-facing half.
//
// Only the ones that depend on nothing but a structural client interface live
// here. The Prisma repository deliberately does NOT: its client is generated
// from the app's schema, so it is bound in the app's composition root instead,
// against the port declared in this package.
// ---------------------------------------------------------------------------

export { RedisHandoffStore } from "./handoff.redis.store.js";
export { RedisRateLimiter } from "./rate-limit.redis.limiter.js";
export { KEY_PREFIX, type RedisLike } from "./redis.js";
