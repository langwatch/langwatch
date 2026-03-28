import { createEnvConfig } from "../../env-create.mjs";

export type ProcessRole = "web" | "worker" | "migration";

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
  baseHost?: string;
  slackPlanLimitChannel?: string;
  slackSignupsChannel?: string;
  slackSubscriptionsChannel?: string;
  hubspotPortalId?: string;
  hubspotReachedLimitFormId?: string;
  hubspotFormId?: string;

  // Event sourcing
  enableEventSourcing?: boolean;

  // Process role — controls which event-sourcing consumers run.
  // "web": dispatch commands only (no BullMQ workers)
  // "worker": full consumers
  // "migration": direct processCommand() calls, reactors excluded
  // undefined: backward-compatible "all" mode
  processRole?: ProcessRole;

  // Customer.io nurturing
  customerIoApiKey?: string;
  customerIoRegion?: "us" | "eu";

  // SaaS mode
  isSaas?: boolean;

  // order to skip using redis, we can probably remove this in with app layer.
  skipRedis?: boolean;

  // Tokenization
  disableTokenization?: boolean;
}

/**
 * Creates AppConfig by merging secrets (from provider) with
 * non-secret config (from env vars). Secrets take precedence over env vars.
 */
export function createAppConfig({
  secrets,
  processRole,
}: {
  secrets: Record<string, string>;
  processRole?: ProcessRole;
}): AppConfig {
  const env = createEnvConfig();

  return {
    nodeEnv: env.NODE_ENV,
    databaseUrl: secrets.DATABASE_URL ?? env.DATABASE_URL,
    clickhouseUrl: secrets.CLICKHOUSE_URL ?? env.CLICKHOUSE_URL,
    enableClickhouse: env.ENABLE_CLICKHOUSE,
    redisUrl: secrets.REDIS_URL ?? env.REDIS_URL,
    redisClusterEndpoints: env.REDIS_CLUSTER_ENDPOINTS,
    langevalsEndpoint: env.LANGEVALS_ENDPOINT,
    baseHost: env.BASE_HOST,
    slackPlanLimitChannel: env.SLACK_PLAN_LIMIT_CHANNEL,
    slackSignupsChannel: env.SLACK_CHANNEL_SIGNUPS,
    slackSubscriptionsChannel: env.SLACK_CHANNEL_SUBSCRIPTIONS,
    hubspotPortalId: env.HUBSPOT_PORTAL_ID,
    hubspotReachedLimitFormId: env.HUBSPOT_REACHED_LIMIT_FORM_ID,
    hubspotFormId: env.HUBSPOT_FORM_ID,
    customerIoApiKey: secrets.CUSTOMER_IO_API_KEY ?? env.CUSTOMER_IO_API_KEY,
    customerIoRegion: env.CUSTOMER_IO_REGION,
    enableEventSourcing: env.ENABLE_EVENT_SOURCING,
    processRole,
    isSaas: env.IS_SAAS,
    skipRedis: env.SKIP_REDIS,
    disableTokenization: process.env.DISABLE_TOKENIZATION === "true",
  };
}

/** Backward-compat: creates config from env vars only (no secrets provider). */
export function createAppConfigFromEnv(overrides?: {
  processRole?: ProcessRole;
}): AppConfig {
  return createAppConfig({ secrets: {}, processRole: overrides?.processRole });
}
