import IORedis from "ioredis";
import { env } from "../env.mjs";
import { createLogger } from "../utils/logger.server";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

const logger = createLogger("langwatch:redis");

export const connection =
  process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD ||
  !!process.env.BUILD_TIME ||
  !env.REDIS_URL
    ? undefined
    : new IORedis(env.REDIS_URL ?? "", {
        maxRetriesPerRequest: null,
        enableOfflineQueue: false,
        tls: env.REDIS_URL?.includes("tls.rejectUnauthorized=false")
          ? { rejectUnauthorized: false }
          : (env.REDIS_URL?.includes("rediss://") as any),
      });

connection?.on("connect", () => {
  logger.info("Redis connected");
});

connection?.on("error", (error) => {
  logger.error("Redis Error:", error);
});

connection?.on("ready", () => {
  logger.info("Redis is ready to accept commands");
});

connection?.on("close", () => {
  logger.info("Redis connection closed");
});

connection?.on("reconnecting", () => {
  logger.info("Redis reconnecting...");
});
