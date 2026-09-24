import { Redis } from "ioredis";

import { type ClientScript, scriptedClient } from "./scripted-client.ts";

/** An ioredis connection, never opened, answering only the commands the test scripted. */
export function redisDouble(script: ClientScript<Redis> = {}): Redis {
  const client = new Redis({ lazyConnect: true, enableOfflineQueue: false });
  return scriptedClient({ client, script, name: "redis" });
}
