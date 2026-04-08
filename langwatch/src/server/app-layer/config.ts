import { createEnvConfig } from "../../env-create.mjs";

export type ProcessRole = "web" | "worker" | "migration";

export interface AppConfig {
  nodeEnv: string;

  // Infrastructure
  databaseUrl: string;
  clickhouseUrl?: string;
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

/** Reads config from createEnvConfig() — the ONE place that owns the schema. */
export function createAppConfigFromEnv(overrides?: {
  processRole?: ProcessRole;
}): AppConfig {
  const env = createEnvConfig();

  return {
    nodeEnv: env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    clickhouseUrl: env.CLICKHOUSE_URL,
    redisUrl: env.REDIS_URL,
    redisClusterEndpoints: env.REDIS_CLUSTER_ENDPOINTS,
    langevalsEndpoint: env.LANGEVALS_ENDPOINT,
    baseHost: env.BASE_HOST,
    slackPlanLimitChannel: env.SLACK_PLAN_LIMIT_CHANNEL,
    slackSignupsChannel: env.SLACK_CHANNEL_SIGNUPS,
    slackSubscriptionsChannel: env.SLACK_CHANNEL_SUBSCRIPTIONS,
    hubspotPortalId: env.HUBSPOT_PORTAL_ID,
    hubspotReachedLimitFormId: env.HUBSPOT_REACHED_LIMIT_FORM_ID,
    hubspotFormId: env.HUBSPOT_FORM_ID,
    customerIoApiKey: env.CUSTOMER_IO_API_KEY,
    customerIoRegion: env.CUSTOMER_IO_REGION,
    processRole: overrides?.processRole,
    isSaas: env.IS_SAAS,
    skipRedis: env.SKIP_REDIS,
    disableTokenization: process.env.DISABLE_TOKENIZATION === "true",
  };
}
