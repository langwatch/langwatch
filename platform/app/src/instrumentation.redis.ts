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
 * groupQueue (src/server/event-sourcing/queues/groupQueue) is built directly on
 * Redis, so tracing ioredis in a process that owns a job queue traces the
 * queue's own bookkeeping rather than the work. Measured in production: ~10,116
 * Redis command spans/sec against 317 job spans/sec, about 32 Redis spans per
 * job, which was 93% of every span the platform emitted. The bulk of it is
 * `evalsha` from cachedLuaScript, plus the ready-set and lease upkeep in
 * scripts.ts. Enable it while debugging Redis latency itself, preferably
 * somewhere without a job queue attached.
 *
 * Exact match on "true": a half-recognised value like "1" or "yes" silently
 * turning this on is the expensive direction to be wrong in.
 */
export const isRedisCommandTracingEnabled = (
  env: NodeJS.ProcessEnv = process.env,
): boolean => env.OTEL_TRACE_REDIS_COMMANDS === "true";

/**
 * Upper bound on the serialized statement, marker included.
 *
 * Dropping the values is not enough on its own: a key is caller-controlled and
 * can be arbitrarily long, so an unbounded key would reintroduce exactly the
 * large attribute this serializer exists to prevent. 256 characters is far
 * beyond any key this codebase constructs, so truncation should be a symptom
 * worth noticing rather than routine.
 */
export const MAX_DB_STATEMENT_CHARS = 256;

const TRUNCATION_MARKER = "...";

/**
 * Records the command and its first key, never the values, so a span cannot
 * carry secrets or grow an unbounded attribute.
 */
export const redisStatementSerializer = (
  cmdName: string,
  cmdArgs: Array<string | Buffer | number | unknown[]>,
): string => {
  const key = typeof cmdArgs[0] === "string" ? cmdArgs[0] : "";
  const statement = key ? `${cmdName} ${key}` : cmdName;

  if (statement.length <= MAX_DB_STATEMENT_CHARS) {
    return statement;
  }

  // Truncation is visible on purpose: a silently shortened key reads as a real
  // key and sends whoever is debugging after a span that never existed.
  return `${statement.slice(
    0,
    MAX_DB_STATEMENT_CHARS - TRUNCATION_MARKER.length,
  )}${TRUNCATION_MARKER}`;
};

export const redisInstrumentationConfig = {
  // Redis calls are only interesting as part of some larger operation. Without
  // this, the connection pool's `connect`/`auth`/`info` and the queue
  // dispatcher's blocking `brpop`/`xread`, none of which have a parent, each
  // became a root span, burying real traces in noise.
  requireParentSpan: true,
  dbStatementSerializer: redisStatementSerializer,
} as const;
