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
  logger.info("connected to redis");
});

connection?.on("error", (error) => {
  logger.error({ error }, "redis error");
});

connection?.on("ready", () => {
  logger.info("ready to accept commands");
});

connection?.on("close", () => {
  logger.info("connection closed");
});

connection?.on("reconnecting", () => {
  logger.info("reconnecting...");
});
