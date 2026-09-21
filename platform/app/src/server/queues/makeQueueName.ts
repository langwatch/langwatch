/**
 * Wraps a queue name in Redis Cluster hash tags ({...}) so every key the
 * queue derives from it (groups, jobs, data, signals, etc.) hashes to the
 * same slot — required for the multi-key Lua scripts GroupQueue evaluates.
 *
 * Lives in its own tiny module so client-side code that needs the wrapped
 * name (e.g. scenario.constants -> SimulationsPage props) doesn't pull the
 * server's Redis wiring (and ioredis) into the browser bundle.
 */
export function makeQueueName(name: string): string {
  if (name.startsWith("{") && name.endsWith("}")) {
    throw new Error(
      `Queue name "${name}" is already wrapped in hash tags. Do not call makeQueueName twice.`,
    );
  }
  return `{${name}}`;
}
