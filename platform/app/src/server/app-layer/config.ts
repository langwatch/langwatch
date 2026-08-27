import { getEnvironmentConfig } from "../../env.mjs";
import {
  resolveNlpLambdaRuntimeConfig,
  type NlpLambdaRuntimeConfig,
} from "~/runtime/api/nlp-lambda.config";
import type { LangyWorkerHttpConfig } from "@langwatch/langy-server";
import { resolveFeatureFlagConfig, type FeatureFlagConfig } from "@langwatch/feature-flag-contract";

export type ProcessRole = "web" | "worker" | "migration" | "all";

/**
 * Roles that run the background worker stack: event-sourcing consumers,
 * process-manager outbox/wake workers, schedulers, and the GroupQueue workers
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
 * Whether a subscriber with the given `runIn` role filter should run under the
 * current process role. A subscriber with no filter runs everywhere. The `"all"`
 * role (dev single-process mode) plays every role, so it satisfies any filter —
 * without this, subscribers declared `runIn: ["worker"]` would be excluded in
 * in-process mode and the worker stack would boot but do no subscriber work.
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

  /** Typed configuration for the process-owned NLP Lambda capability. */
  nlpLambda: NlpLambdaRuntimeConfig;

  /** Feature overrides resolved once before the service graph is composed. */
  featureFlags: FeatureFlagConfig;

  // Infrastructure
  databaseUrl: string;
  clickhouseUrl?: string;
  redisUrl?: string;
  redisClusterEndpoints?: string;
  /** Raw `REDIS_DB_INDEX`; `@langwatch/redis-client` validates and applies it. */
  redisDbIndex?: string;

  // Services
  langevalsEndpoint?: string;
  langyWorker?: LangyWorkerHttpConfig;
  baseHost?: string;
  slackPlanLimitChannel?: string;
  slackSignupsChannel?: string;
  slackSubscriptionsChannel?: string;
  hubspotPortalId?: string;
  hubspotReachedLimitFormId?: string;
  hubspotFormId?: string;

  // Process role — controls which event-sourcing consumers run.
  // "web": dispatch commands only (no queue consumers)
  // "worker": full consumers
  // "all": web server + full consumers in one process (dev-only, WORKERS_IN_PROCESS=1)
  // "migration": direct processCommand() calls, subscribers excluded
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

  // Viewer presentation policy resolved once at process composition.
  opsSidebarEmails?: readonly string[];
}

/** Maps the environment explicitly validated by executable boot. */
export function createAppConfigFromEnv(overrides?: {
  processRole?: ProcessRole;
}): AppConfig {
  const env = getEnvironmentConfig();

  return {
    nodeEnv: env.NODE_ENV,
    nlpLambda: resolveNlpLambdaRuntimeConfig(env),
    featureFlags: resolveFeatureFlagConfig(process.env),
    databaseUrl: env.DATABASE_URL,
    clickhouseUrl: env.CLICKHOUSE_URL,
    redisUrl: env.REDIS_URL,
    redisClusterEndpoints: env.REDIS_CLUSTER_ENDPOINTS,
    redisDbIndex: env.REDIS_DB_INDEX,
    langevalsEndpoint: env.LANGEVALS_ENDPOINT,
    langyWorker: resolveLangyWorkerConfig({
      agentUrl: env.OPENCODE_AGENT_URL,
      internalSecret: env.LANGY_INTERNAL_SECRET,
    }),
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
    disableTokenization: env.DISABLE_TOKENIZATION,
    opsSidebarEmails: env.SHOW_OPS_IN_MAIN_SIDEBAR?.split(",")
      .map((email: string) => email.trim().toLowerCase())
      .filter(Boolean),
  };
}

export function resolveLangyWorkerConfig(input: {
  agentUrl: string | undefined;
  internalSecret: string | undefined;
}): LangyWorkerHttpConfig | undefined {
  const hasAgentUrl = input.agentUrl !== undefined;
  const hasInternalSecret = input.internalSecret !== undefined;

  if (!hasAgentUrl && !hasInternalSecret) {
    return void 0;
  }

  if (!input.agentUrl || !input.internalSecret) {
    throw new Error(
      "OPENCODE_AGENT_URL and LANGY_INTERNAL_SECRET must be configured together",
    );
  }

  return {
    agentUrl: input.agentUrl,
    internalSecret: input.internalSecret,
  };
}
