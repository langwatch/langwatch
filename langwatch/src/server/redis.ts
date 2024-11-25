import IORedis from "ioredis";
import { env } from "../env.mjs";
import { getDebugger } from "../utils/logger";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

const debug = getDebugger("langwatch:redis");

export const connection =
  process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD || process.env.BUILD_TIME
    ? undefined
    : new IORedis(env.REDIS_URL, {
        maxRetriesPerRequest: null,
        enableOfflineQueue: false,
        tls: env.REDIS_URL.includes("tls.rejectUnauthorized=false") ? { rejectUnauthorized: false } : env.REDIS_URL.includes("rediss://"),
      });

connection?.on("connect", () => {
  debug("Redis connected");
});

connection?.on("error", (error) => {
  debug("Redis Error:", error);
});

connection?.on("ready", () => {
  debug("Redis is ready to accept commands");
});

connection?.on("close", () => {
  debug("Redis connection closed");
});

connection?.on("reconnecting", () => {
  debug("Redis reconnecting...");
});
