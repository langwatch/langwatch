import { createEnvConfig } from "../../env-create.mjs";
import { parseRedisDbIndex } from "../redis-db-index";

export type ProcessRole = "web" | "worker" | "migration" | "all";

/**
 * Roles that run the background worker stack: the event-sourcing consumers,
 * the outbox drainer, the heartbeat scheduler, and the GroupQueue workers
 * booted in `startWorkers()`.
 *
 * - `"worker"` — the dedicated worker deployment (prod + the default dev
 *   second process).
 * - `"all"` — the dev-only single-process mode where the web server also
 *   hosts the workers in-process (WORKERS_IN_PROCESS=1). Never used in prod,
 *   which always runs web and worker as separate deployments.
 */
export function roleRunsWorkers(role: ProcessRole | undefined): boolean {
  return role === "worker" || role === "all";
}

/**
 * Whether a reactor with the given `runIn` role filter should run under the
 * current process role. A reactor with no filter runs everywhere. The `"all"`
 * role (dev single-process mode) plays every role, so it satisfies any filter —
 * without this, reactors declared `runIn: ["worker"]` would be excluded in
 * in-process mode and the worker stack would boot but do no reactor work.
 */
export function roleSatisfiesRunIn({
  runIn,
  processRole,
}: {
  runIn: ProcessRole[] | undefined;
  processRole: ProcessRole | undefined;
}): boolean {
  if (!runIn || !processRole) return true;
  if (processRole === "all") return true;
  return runIn.includes(processRole);
}

export interface AppConfig {
  nodeEnv: string;

  // Infrastructure
  databaseUrl: string;
  clickhouseUrl?: string;
  redisUrl?: string;
  redisClusterEndpoints?: string;
  redisDbIndex?: number;

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
  // "all": web server + full consumers in one process (dev-only, WORKERS_IN_PROCESS=1)
  // "migration": direct processCommand() calls, reactors excluded
  // undefined: dispatch-only (web-like) — no consumers
  // Use `roleRunsWorkers(role)` rather than comparing to "worker" directly.
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
    redisDbIndex: parseRedisDbIndex(env.REDIS_DB_INDEX),
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
