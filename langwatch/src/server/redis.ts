import IORedis from "ioredis";
import { env } from "../env.mjs";

export const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  tls: true as any,
});
