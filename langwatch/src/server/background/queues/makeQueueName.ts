/**
 * Wraps a queue name in a Redis Cluster hash tag.
 *
 * BullMQ creates multiple Redis keys per queue (e.g. bull:<name>:wait,
 * bull:<name>:active). Redis Cluster distributes keys across slots by
 * hashing the key name. Without a hash tag, those keys land on different
 * slots and Lua scripts that touch them atomically fail with CROSSSLOT.
 *
 * Wrapping the name in {braces} forces Redis to hash only the braced
 * portion, guaranteeing all keys for a queue land on the same slot.
 *
 * @example
 *   makeQueueName("collector")        // → "{collector}"
 *   makeQueueName("pipeline/handler") // → "{pipeline/handler}"
 */
export function makeQueueName(name: string): string {
  if (name.startsWith("{") && name.endsWith("}")) {
    throw new Error(
      `Queue name "${name}" is already wrapped in hash tags. Do not call makeQueueName twice.`,
    );
  }
  return `{${name}}`;
}
