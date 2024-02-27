import IORedis from "ioredis";
import { env } from "../env.mjs";
import { getDebugger } from "../utils/logger";

const debug = getDebugger("langwatch:redis");

export const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  tls: env.NODE_ENV === 'development' ? false : true as any,
});

connection.on("connect", () => {
  debug("Redis connected");
});
