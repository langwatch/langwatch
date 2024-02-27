import IORedis from "ioredis";
import { env } from "../env.mjs";
import { getDebugger } from "../utils/logger";

const debug = getDebugger("langwatch:redis");

export const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  tls:
    env.NODE_ENV === "production"
      ? (true as any)
      : env.REDIS_URL.includes("rediss://"),
});

connection.on("connect", () => {
  debug("Redis connected");
});
