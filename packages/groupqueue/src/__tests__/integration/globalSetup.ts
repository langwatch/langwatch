import { startTestRedis, writeTestRedisInfo } from "./testRedis";

export async function setup(): Promise<void> {
  const info = await startTestRedis();
  writeTestRedisInfo(info);
}

export async function teardown(): Promise<void> {
  // Nothing to stop: a native local Redis is the always-on dev instance
  // (never used here — see testRedis.ts), and a `.withReuse()` container is
  // left running for the next run.
}
