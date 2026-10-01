import { Redis } from "ioredis";

import {
  type MemoryRedisStore,
  memoryRedisCommands,
  memoryRedisStore,
} from "./memory-redis-commands.ts";
import { type ClientScript, scriptedClient } from "./scripted-client.ts";

export { type MemoryRedisStore, memoryRedisStore } from "./memory-redis-commands.ts";

/** An ioredis connection, never opened, answering only the commands the test scripted. */
export function redisDouble(script: ClientScript<Redis> = {}): Redis {
  const client = new Redis({ lazyConnect: true, enableOfflineQueue: false });
  return scriptedClient({ client, script, name: "redis" });
}

/**
 * An ioredis connection, never opened, answering the common commands from an in-process
 * store its duplicates share; the script overrides or adds commands (a Lua `eval`, a spy).
 */
export function memoryRedisDouble({
  store = memoryRedisStore(),
  script = {},
}: { store?: MemoryRedisStore; script?: ClientScript<Redis> } = {}): Redis {
  const client = new Redis({ lazyConnect: true, enableOfflineQueue: false });
  const commands: ClientScript<Redis> = {
    ...memoryRedisCommands({
      store,
      client,
      self: () => double,
      duplicate: () => memoryRedisDouble({ store, script }),
      batch: () => queuedBatch({ commands }),
    }),
    ...script,
  };
  const double = scriptedClient({ client, script: commands, name: "redis" });
  return double;
}

function queuedBatch({ commands }: { commands: object }): Record<string, unknown> {
  const queued: (() => unknown)[] = [];
  const chain: Record<string, unknown> = {
    exec: async () => {
      const results: [Error | null, unknown][] = [];
      for (const run of queued) {
        try {
          results.push([null, await run()]);
        } catch (error) {
          results.push([error instanceof Error ? error : new Error(String(error)), null]);
        }
      }
      return results;
    },
  };
  const proxy: Record<string, unknown> = new Proxy(chain, {
    get(target, property) {
      if (typeof property === "symbol" || Object.hasOwn(target, property)) {
        return Reflect.get(target, property);
      }
      const command: unknown = Reflect.get(commands, property);
      if (typeof command !== "function")
        throw new Error(`redis.pipeline.${property} is not scripted`);
      return (...args: unknown[]) => {
        queued.push(() => Reflect.apply(command, undefined, args));
        return proxy;
      };
    },
  });
  return proxy;
}
