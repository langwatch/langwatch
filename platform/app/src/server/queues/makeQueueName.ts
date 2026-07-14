/**
 * Wraps a queue name in Redis Cluster hash tags ({...}) so every key BullMQ
 * derives from the queue (wait, active, delayed, etc.) hashes to the same
 * slot — required for the multi-key Lua scripts BullMQ uses.
 *
 * Lives in its own tiny module so client-side code that needs the wrapped
 * name (e.g. scenario.constants -> SimulationsPage props) doesn't pull
 * `~/server/redis` (and ioredis) into the browser bundle.
 */
export function makeQueueName(name: string): string {
  if (name.startsWith("{") && name.endsWith("}")) {
    throw new Error(
      `Queue name "${name}" is already wrapped in hash tags. Do not call makeQueueName twice.`,
    );
  }
  return `{${name}}`;
}
