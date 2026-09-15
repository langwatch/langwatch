/**
 * The Redis this package's integration lane runs against, resolved once.
 * `REDIS_URL` is honoured for a stack exporting only that: reading one name
 * alone made suites skip, or fail, against a Redis that was running.
 */
export function testRedisUrl(): string | undefined {
  return process.env.LANGWATCH_TEST_REDIS_URL ?? process.env.REDIS_URL;
}
