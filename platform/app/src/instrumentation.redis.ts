/**
 * ioredis tracing policy, kept separate from instrumentation.node so it can be
 * tested without booting the OTel SDK.
 *
 * instrumentation.node loads its dependencies through gated `require` calls so
 * nothing is pulled in when observability is off. That makes the module itself
 * awkward to exercise in a test, but the two decisions worth protecting are
 * pure: whether Redis tracing is on, and what a Redis span records.
 */

/**
 * Off unless explicitly enabled.
 *
 * BullMQ drives every queue operation through Redis, so tracing ioredis in a
 * process that owns a job queue traces the queue's own bookkeeping rather than
 * the work. Measured in production: ~10,116 Redis command spans/sec against 317
 * job spans/sec, about 32 Redis spans per job, which was 93% of every span the
 * platform emitted. Enable it while debugging Redis latency itself, preferably
 * somewhere without a job queue attached.
 *
 * Exact match on "true": a half-recognised value like "1" or "yes" silently
 * turning this on is the expensive direction to be wrong in.
 */
export const isRedisCommandTracingEnabled = (
  env: NodeJS.ProcessEnv = process.env,
): boolean => env.OTEL_TRACE_REDIS_COMMANDS === "true";

/**
 * Records the command and its first key, never the values, so a span cannot
 * carry secrets or grow an unbounded attribute.
 */
export const redisStatementSerializer = (
  cmdName: string,
  cmdArgs: Array<string | Buffer | number | unknown[]>,
): string => {
  const key = typeof cmdArgs[0] === "string" ? cmdArgs[0] : "";
  return key ? `${cmdName} ${key}` : cmdName;
};

export const redisInstrumentationConfig = {
  // Redis calls are only interesting as part of some larger operation. Without
  // this, the connection pool's `connect`/`auth`/`info` and the queue
  // dispatcher's blocking `brpop`/`xread`, none of which have a parent, each
  // became a root span, burying real traces in noise.
  requireParentSpan: true,
  dbStatementSerializer: redisStatementSerializer,
};
