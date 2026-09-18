import { Config, type ProcessConfigOf } from "@langwatch/config";
import { Secret } from "@langwatch/secrets";
import { z } from "zod";

export const storesOwner = {
  name: "stores",
  config: Config.define((c) => ({
    defaultRetentionDays: c.env(
      "DEFAULT_RETENTION_DAYS",
      z.coerce.number().int().positive().default(30),
    ),
    rateLimit: {
      requests: c.env("API_RATE_LIMIT_REQUESTS", z.coerce.number().int().positive().default(60)),
      seconds: c.env("API_RATE_LIMIT_SECONDS", z.coerce.number().int().positive().default(60)),
    },
  })),
  secrets: {
    database: Secret.load("DATABASE_URL", { optional: true }),
    clickhouse: Secret.load("CLICKHOUSE_URL", { optional: true }),
    redis: Secret.load("REDIS_URL", { optional: true }),
    encryption: Secret.load("CREDENTIALS_SECRET", { optional: true }),
  },
} as const;
export type StoresConfig = ProcessConfigOf<readonly [typeof storesOwner]>["stores"];
