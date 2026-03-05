import { createEnvConfig } from "../../env-create.mjs";

export type ProcessRole = "web" | "worker";

export interface AppConfig {
  nodeEnv: string;

  // Infrastructure
  databaseUrl: string;
  clickhouseUrl?: string;
  enableClickhouse?: boolean;
  redisUrl?: string;
  redisClusterEndpoints?: string;

  // Services
  langevalsEndpoint?: string;

  // Event sourcing
  enableEventSourcing?: boolean;

  // Process role — controls which event-sourcing consumers run.
  // "web": dispatch commands only (no BullMQ workers)
  // "worker": full consumers
  // undefined: backward-compatible "all" mode
  processRole?: ProcessRole;

  // SaaS mode
  isSaas?: boolean;

  // order to skip using redis, we can probably remove this in with app layer.
  skipRedis?: boolean;

  // Tokenization
  disableTokenization?: boolean;
}

/** Reads config from createEnvConfig() — the ONE place that owns the schema. */
export function createAppConfigFromEnv(overrides?: { processRole?: ProcessRole }): AppConfig {
  const env = createEnvConfig();

  return {
    nodeEnv: env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    clickhouseUrl: env.CLICKHOUSE_URL,
    enableClickhouse: env.ENABLE_CLICKHOUSE,
    redisUrl: env.REDIS_URL,
    redisClusterEndpoints: env.REDIS_CLUSTER_ENDPOINTS,
    langevalsEndpoint: env.LANGEVALS_ENDPOINT,
    enableEventSourcing: env.ENABLE_EVENT_SOURCING,
    processRole: overrides?.processRole,
    isSaas: env.IS_SAAS,
    skipRedis: env.SKIP_REDIS,
    disableTokenization: process.env.DISABLE_TOKENIZATION === "true",
  };
}
