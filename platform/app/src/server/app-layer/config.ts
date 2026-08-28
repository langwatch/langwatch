import { getEnvironmentConfig } from "../../env.mjs";
import { Config, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import {
  resolveNlpLambdaRuntimeConfig,
  type NlpLambdaRuntimeConfig,
} from "~/runtime/api/nlp-lambda.config";
import type { LangyWorkerHttpConfig } from "@langwatch/langy-server";
import { resolveFeatureFlagConfig, type FeatureFlagConfig } from "@langwatch/feature-flag-contract";
import {
  EVAL_INPUTS_HARD_CEILING_BYTES,
  EVAL_INPUTS_INLINE_MAX_BYTES,
  EVAL_INPUTS_PREVIEW_BYTES,
  type EvaluationInputOffloadConfig,
} from "@langwatch/evaluation-server";
import { DEFAULT_MODEL } from "~/utils/constants";
import { z } from "zod";
import type { GroupQueuePolicy } from "@langwatch/group-queue";

export type ProcessRole = "web" | "worker" | "migration" | "all";

const legacyEventingConfigDefinition = RuntimeConfig.define({
  foldCacheTtlSeconds: Config.value(
    z
      .string()
      .optional()
      .transform((value) => {
        if (value === undefined || value === "") return void 0;

        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : void 0;
      }),
    { env: "LANGWATCH_FOLD_CACHE_TTL_SECONDS" },
  ),
});

type LegacyEventingConfig = ConfigValue<typeof legacyEventingConfigDefinition>;

export function resolveLegacyEventingConfig(
  source: Readonly<Record<string, unknown>>,
): LegacyEventingConfig {
  return RuntimeConfig.create({
    name: "legacy Eventing",
    definition: legacyEventingConfigDefinition,
    source,
  }).value;
}

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

/**
 * The queue's operational policy after the executable has selected its
 * environment source. `undefined` deliberately lets Group Queue apply its
 * established defaults; zero remains meaningful for the two dispatch caps.
 */
export type GroupQueueProcessConfig = GroupQueuePolicy;

/**
 * Maps the legacy queue environment names once, at process composition.
 *
 * This preserves the former `Number(...)` handling for global concurrency:
 * only a positive safe integer overrides the queue default. Dispatch caps are
 * non-negative so `0` remains the documented kill switch / disabled dynamic
 * budget. Codec flags retain their exact true-only opt-in semantics.
 */
export function resolveGroupQueueProcessConfig(source: {
  globalConcurrency?: string | undefined;
  zstdWritesEnabled?: string | undefined;
  msgpackWritesEnabled?: string | undefined;
  tenantConcurrencyCap?: string | undefined;
  globalConcurrencyBudget?: string | undefined;
}): GroupQueueProcessConfig {
  return {
    globalConcurrency: positiveSafeIntegerOrUndefined(source.globalConcurrency),
    tenantConcurrencyCap: nonNegativeSafeIntegerOrUndefined(source.tenantConcurrencyCap),
    globalConcurrencyBudget: nonNegativeSafeIntegerOrUndefined(source.globalConcurrencyBudget),
    compression: source.zstdWritesEnabled === "true" ? "zstd" : "gzip",
    payloadCodec: source.msgpackWritesEnabled === "true" ? "msgpack" : "json",
  };
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
  /** Process-composed HMAC pepper for the Gateway virtual-key control plane. */
  virtualKeyPepper?: string;
  redisClusterEndpoints?: string;
  /** Raw `REDIS_DB_INDEX`; `@langwatch/redis-client` validates and applies it. */
  redisDbIndex?: string;
  /** Validated policy supplied to Group Queue at process composition. */
  groupQueue: GroupQueueProcessConfig;

  // Services
  langevalsEndpoint?: string;
  langyWorker?: LangyWorkerHttpConfig;
  scenarioExecution: {
    langwatchEndpoint: string;
    nlpServiceUrl: string;
    legacyDefaultModel: string;
    childEnvironment: {
      path?: string;
      home?: string;
      user?: string;
      shell?: string;
      lang?: string;
      lcAll?: string;
      term?: string;
      nodeCompileCache?: string;
      corepackEnableDownloadPrompt?: string;
      nodeExtraCaCerts?: string;
    };
  };
  /** Public application origin used when rendering links in durable work. */
  baseHost: string;
  slackPlanLimitChannel?: string;
  slackSignupsChannel?: string;
  slackSubscriptionsChannel?: string;
  hubspotPortalId?: string;
  hubspotReachedLimitFormId?: string;
  hubspotFormId?: string;
  /** Shared secret accepted by the Auth0 SCIM webhook transport. */
  auth0ScimWebhookSecret?: string;

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

  /** Whether coding-agent infrastructure spans are retained at ingestion. */
  codingAgentSpanFilterEnabled: boolean;

  /** Typed limits for durable Evaluation input offload. */
  evaluationInputsOffload: EvaluationInputOffloadConfig;

  /** Redis fold-cache TTL, constrained by Eventing to its replication-lag floor. */
  eventingFoldCacheTtlSeconds?: number;
}

/** Maps the environment explicitly validated by executable boot. */
export function createAppConfigFromEnv(overrides?: { processRole?: ProcessRole }): AppConfig {
  const env = getEnvironmentConfig();

  const baseHost = env.BASE_HOST;
  if (!baseHost) {
    throw new Error("BASE_HOST is required to boot the application");
  }

  const evaluationInputsOffload: EvaluationInputOffloadConfig = {
    inlineMaxBytes: readEvaluationByteEnv(
      env.LANGWATCH_EVAL_INPUTS_INLINE_MAX_BYTES,
      EVAL_INPUTS_INLINE_MAX_BYTES,
    ),
    hardCeilingBytes: readEvaluationByteEnv(
      env.LANGWATCH_EVAL_INPUTS_HARD_CEILING_BYTES,
      EVAL_INPUTS_HARD_CEILING_BYTES,
    ),
    previewBytes: EVAL_INPUTS_PREVIEW_BYTES,
  };
  const eventing = resolveLegacyEventingConfig({
    LANGWATCH_FOLD_CACHE_TTL_SECONDS: env.LANGWATCH_FOLD_CACHE_TTL_SECONDS,
  });
  const groupQueue = resolveGroupQueueProcessConfig({
    globalConcurrency: env.GLOBAL_QUEUE_CONCURRENCY,
    zstdWritesEnabled: env.GROUP_QUEUE_ZSTD_WRITES_ENABLED,
    msgpackWritesEnabled: env.GROUP_QUEUE_MSGPACK_WRITES_ENABLED,
    tenantConcurrencyCap: env.LANGWATCH_DISPATCH_TENANT_CAP,
    globalConcurrencyBudget: env.LANGWATCH_DISPATCH_GLOBAL_BUDGET,
  });

  return {
    nodeEnv: env.NODE_ENV,
    nlpLambda: resolveNlpLambdaRuntimeConfig(env),
    featureFlags: resolveFeatureFlagConfig(process.env),
    databaseUrl: env.DATABASE_URL,
    virtualKeyPepper: env.LW_VIRTUAL_KEY_PEPPER,
    clickhouseUrl: env.CLICKHOUSE_URL,
    redisUrl: env.REDIS_URL,
    redisClusterEndpoints: env.REDIS_CLUSTER_ENDPOINTS,
    redisDbIndex: env.REDIS_DB_INDEX,
    groupQueue,
    langevalsEndpoint: env.LANGEVALS_ENDPOINT,
    scenarioExecution: {
      langwatchEndpoint: env.LANGWATCH_ENDPOINT,
      nlpServiceUrl: env.LANGWATCH_NLP_SERVICE,
      legacyDefaultModel: DEFAULT_MODEL,
      childEnvironment: {
        path: process.env.PATH,
        home: process.env.HOME,
        user: process.env.USER,
        shell: process.env.SHELL,
        lang: process.env.LANG,
        lcAll: process.env.LC_ALL,
        term: process.env.TERM,
        nodeCompileCache: process.env.NODE_COMPILE_CACHE,
        corepackEnableDownloadPrompt: process.env.COREPACK_ENABLE_DOWNLOAD_PROMPT,
        nodeExtraCaCerts: process.env.NODE_EXTRA_CA_CERTS,
      },
    },
    langyWorker: resolveLangyWorkerConfig({
      agentUrl: env.OPENCODE_AGENT_URL,
      internalSecret: env.LANGY_INTERNAL_SECRET,
    }),
    baseHost,
    slackPlanLimitChannel: env.SLACK_PLAN_LIMIT_CHANNEL,
    slackSignupsChannel: env.SLACK_CHANNEL_SIGNUPS,
    slackSubscriptionsChannel: env.SLACK_CHANNEL_SUBSCRIPTIONS,
    hubspotPortalId: env.HUBSPOT_PORTAL_ID,
    hubspotReachedLimitFormId: env.HUBSPOT_REACHED_LIMIT_FORM_ID,
    hubspotFormId: env.HUBSPOT_FORM_ID,
    auth0ScimWebhookSecret: env.AUTH0_SCIM_WEBHOOK_SECRET,
    customerIoApiKey: env.CUSTOMER_IO_API_KEY,
    customerIoRegion: env.CUSTOMER_IO_REGION,
    processRole: overrides?.processRole,
    isSaas: env.IS_SAAS,
    skipRedis: env.SKIP_REDIS,
    disableTokenization: env.DISABLE_TOKENIZATION,
    opsSidebarEmails: env.SHOW_OPS_IN_MAIN_SIDEBAR?.split(",")
      .map((email: string) => email.trim().toLowerCase())
      .filter(Boolean),
    codingAgentSpanFilterEnabled: env.LANGWATCH_DISABLE_CODING_AGENT_SPAN_FILTER !== true,
    evaluationInputsOffload,
    eventingFoldCacheTtlSeconds: eventing.foldCacheTtlSeconds,
  };
}

function positiveSafeIntegerOrUndefined(raw: string | undefined): number | undefined {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function nonNegativeSafeIntegerOrUndefined(raw: string | undefined): number | undefined {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function readEvaluationByteEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
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
    throw new Error("OPENCODE_AGENT_URL and LANGY_INTERNAL_SECRET must be configured together");
  }

  return {
    agentUrl: input.agentUrl,
    internalSecret: input.internalSecret,
  };
}
