import {
  assertObservabilityDoesNotSelfIngest,
  clickhouseConfigDefinition,
  Config,
  groupQueueConfigDefinition,
  loggerConfigDefinition,
  observabilityConfigDefinition,
  parseDataplaneS3RoutingTable,
  postgresConfigDefinition,
  redisConfigDefinition,
  resolveTelemetryConfiguration,
  runtimeIdentityConfigDefinition,
  RuntimeConfig,
  type ConfigValue,
} from "@langwatch/config";
import { assertAuthServerConfig, authServerConfigDefinition } from "@langwatch/auth-contract";
import { authzServerConfigDefinition } from "@langwatch/authz-contract";
import { automationServerConfigDefinition } from "@langwatch/automation-contract";
import {
  assertBillingServerConfig,
  billingServerConfigDefinition,
} from "@langwatch/enterprise-billing-contract";
import { dataPrivacyServerConfigDefinition } from "@langwatch/data-privacy-contract";
import {
  dataRetentionServerConfigDefinition,
  resolvePlatformDefaultRetentionDays,
} from "@langwatch/data-retention-contract";
import { evaluationServerConfigDefinition } from "@langwatch/evaluation-contract";
import { gatewayServerConfigDefinition } from "@langwatch/gateway-contract";
import { githubServerConfigDefinition } from "@langwatch/github-contract";
import { langyServerConfigDefinition } from "@langwatch/langy-contract";
import { licensingServerConfigDefinition } from "@langwatch/enterprise-licensing-contract";
import { logServerConfigDefinition } from "@langwatch/log-contract";
import { metricServerConfigDefinition } from "@langwatch/metric-contract";
import { modelProviderServerConfigDefinition } from "@langwatch/model-provider-contract";
import { notificationServerConfigDefinition } from "@langwatch/notification-contract";
import { opsServerConfigDefinition } from "@langwatch/ops-contract";
import { saasServerConfigDefinition } from "@langwatch/enterprise-saas-contract";
import { secretServerConfigDefinition } from "@langwatch/secret-contract";
import { storedObjectServerConfigDefinition } from "@langwatch/stored-object-contract";
import { traceServerConfigDefinition } from "@langwatch/trace-contract";
import { webhookServerConfigDefinition } from "@langwatch/enterprise-webhook-contract";
import {
  otlpMetricsExportOptionsFrom,
  type OtlpMetricsExportOptions,
} from "@langwatch/observability/node";
import {
  parseRoutingTable,
  poolSizingFromEnv,
  type PoolSizingInput,
} from "@langwatch/clickhouse-client";
import { resolveFeatureFlagConfig, type FeatureFlagConfig } from "@langwatch/feature-flag-contract";
import { getLatestOpenAIChatFlagship } from "@langwatch/model-provider-contract";
import { resolveGroupQueuePolicyFromEnv, type GroupQueuePolicy } from "@langwatch/group-queue";
import { EmailProviderService, type MailerConfiguration } from "@langwatch/notification-server";
import { RedisConfigService, type RedisConfigResolution } from "@langwatch/redis-client";
import { z } from "zod";

const DEFAULT_LOCAL_STORAGE_ROOT = "/var/lib/langwatch/objects";
/** The model a scenario target that names none falls back to. */
const REGISTRY_FLAGSHIP_MODEL = getLatestOpenAIChatFlagship() ?? "openai/gpt-5";
const DEFAULT_PRODUCTION_QUEUE_DRAIN_MS = 25_000;
const DEFAULT_DEVELOPMENT_QUEUE_DRAIN_MS = 5_000;
const APP_CLOSE_SLACK_MS = 5_000;
/** The application's own Presidio ceiling; neither graph reads it from the environment. */
const DEFAULT_PRESIDIO_TIMEOUT_MS = 60_000;
const PROCESS_CLOSE_SLACK_MS = 15_000;

const optionalEnvironmentString = z.string().optional();

const optionalProxyValue = optionalEnvironmentString.transform((value) => {
  const trimmed = value?.trim();
  return trimmed || undefined;
});

export const workerConfigDefinition = RuntimeConfig.define({
  /** A standalone worker owns background consumer behaviour once installed. */
  processRole: Config.value(z.literal("worker").default("worker"), { env: "WORKER_PROCESS_ROLE" }),
  ...runtimeIdentityConfigDefinition,
  serviceName: Config.value(z.string().min(1).default("langwatch:worker"), {
    env: "WORKER_SERVICE_NAME",
  }),
  logger: { ...loggerConfigDefinition },
  observability: { ...observabilityConfigDefinition },
  shutdown: {
    queueDrainTimeoutMs: Config.value(optionalEnvironmentString, {
      env: "SHUTDOWN_DRAIN_TIMEOUT_MS",
    }),
  },
  /**
   * Optional in the same way as the app's schema, since a worker must boot
   * without a GitHub App configured.
   */
  github: { ...githubServerConfigDefinition },
  /**
   * The one variable both graphs gate their cross-pipeline billing meter on.
   * Disagreement silently drops or double-meters billable events.
   * `environmentOneOrTrueSchema` matches the App's reading exactly.
   */
  deployment: {
    saas: saasServerConfigDefinition.isSaas,
    /**
     * Read at the App's own spelling; SSO admin gating relies on it
     * (ADR-117 D05 tier 1). Unset means nobody — the fail-closed answer
     * both surfaces must agree on.
     */
    adminEmails: saasServerConfigDefinition.adminEmails,
    /**
     * Rotation-only variable; unset falls back to the embedded production
     * public key. Read at the App's spelling since plan resolution runs in
     * both processes (ADR-027); blank resolves to undefined, never "".
     */
    licensePublicKey: licensingServerConfigDefinition.publicKey,
  },
  /**
   * Optional as the app's schema is: a self-hosted worker composes no
   * sender, a SaaS worker refuses to compose without a key — matching
   * `AppStripeRuntime.create`.
   */
  stripe: { ...billingServerConfigDefinition },
  /**
   * PostHog vars read at the app's spelling since both graphs feed one
   * `first_trace_integrated` funnel; not secrets, hence `Config.value`.
   * Ops vars (`INSTALL_METHOD`, `DISABLE_USAGE_STATS`) match the app too.
   */
  ops: { ...opsServerConfigDefinition },
  /**
   * App's own spelling (`mailer.private-config.ts`): mismatched sender
   * domains fail SPF on one side only. `BASE_HOST` is load-bearing — see
   * `resolveWorkerMailConfig` for what its absence refuses.
   */
  mail: {
    baseHost: Config.value(optionalEnvironmentString, { env: "BASE_HOST" }),
    ...notificationServerConfigDefinition,
  },
  /**
   * The deployment's one browser-session identity, read through the auth
   * feature's own schema so both processes reach one answer. Its secret also
   * signs unsubscribe links (ADR-031) and is the `CREDENTIALS_SECRET`
   * fallback (ADR-027 order).
   */
  browserSession: { ...authServerConfigDefinition },
  /**
   * Both switches at the API tier's exact spelling/rule — one deployment
   * needs one answer. `DEMO_PROJECT_ID` blank means no demo project, never
   * a project id of "" (a blank filter widens rather than narrows).
   */
  authz: { ...authzServerConfigDefinition },
  automation: { ...automationServerConfigDefinition },
  /** The stored-credential cipher key; automation decrypts with the same one. */
  secret: { ...secretServerConfigDefinition },
  /**
   * Same four vars the app reads for redaction; missing `LANGEVALS_ENDPOINT`
   * is fatal in production. Credentials carried raw/unparsed — the parse
   * and its degrade-on-invalid-JSON behaviour live in `resolveWorkerTracePrivacyConfig`.
   */
  tracePrivacy: { ...dataPrivacyServerConfigDefinition },
  /** Where the evaluator service answers; the privacy pipeline reads it too. */
  evaluation: { ...evaluationServerConfigDefinition },
  /**
   * Decides something different from the four privacy vars it's projected
   * alongside (estimating usage for spans that arrived without it). Timeout
   * carried raw: `z.coerce.number()` would reject "10s", where the app parses it as 10.
   */
  trace: { ...traceServerConfigDefinition },
  /**
   * Both default OFF, read at the app's spelling: these gate what a
   * customer is ALLOWED to point an endpoint at, so disagreement here
   * means one surface accepts an endpoint the other refuses to deliver.
   */
  webhooks: { ...webhookServerConfigDefinition },
  /**
   * URL and secret are refused TOGETHER, as `resolveLangyWorkerConfig`
   * refuses them: a URL alone dispatches unauthenticated, a secret alone
   * dispatches nowhere. Both absent is a valid "no agent manager" deployment.
   */
  langy: langyServerConfigDefinition,
  /**
   * Carried raw (not a number): `settlementGraceMs` in
   * `@langwatch/gateway-server` owns the parse, bound and warning — the
   * same function the REST settlement policy calls on the same variable.
   */
  gateway: { spendSettlementGraceMs: gatewayServerConfigDefinition.spendSettlementGraceMs },
  /**
   * Same vars/functions the app reads, since the app produces into these
   * pipelines while this process consumes them — a differently-clamped
   * lane count would split a command from its own retry.
   */
  processing: {
    metricShards: metricServerConfigDefinition.processingShards,
    logShards: logServerConfigDefinition.processingShards,
  },
  /**
   * ADR-066. Same var the app reads: both graphs cache one Redis keyspace,
   * so a different TTL expires the other's entries early, and a fold-cache
   * miss is treated as authoritative. Unparseable falls back to the store's floor.
   */
  eventing: {
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
  },
  /**
   * App's spelling, port 2999 default: the chart's startupProbe/
   * livenessProbe name this port, so listening elsewhere gets the pod
   * restarted by the kubelet on every rollout.
   */
  liveness: {
    metricsPort: Config.value(optionalEnvironmentString, { env: "WORKER_METRICS_PORT" }),
  },
  /**
   * Same var/default the app reads: both graphs stamp rows in one
   * ClickHouse, so a different default here expires a tenant's events early.
   */
  retention: { ...dataRetentionServerConfigDefinition },
  infrastructure: {
    /**
     * App's own spelling: the process store, every ledger head and every
     * read-side repository live in the database the control plane writes.
     */
    database: { ...postgresConfigDefinition },
    /**
     * Event store endpoint plus per-org private routes. Routes are read off
     * the raw environment (names carry the org id,
     * `CLICKHOUSE_URL__<label>__<organizationId>`) via the shared parser.
     */
    clickhouse: { ...clickhouseConfigDefinition },
    redis: { ...redisConfigDefinition },
    groupQueue: { ...groupQueueConfigDefinition },
    storage: { ...storedObjectServerConfigDefinition },
    outboundProxy: {
      https: Config.value(optionalProxyValue, { env: "HTTPS_PROXY" }),
      http: Config.value(optionalProxyValue, { env: "HTTP_PROXY" }),
      noProxy: Config.value(optionalProxyValue, { env: "NO_PROXY" }),
    },
    /**
     * Only two new leaves; three more inputs are deliberate projections of
     * existing ones (`deployment.saas`, `automation.credentialsEncryptionKey`)
     * so a credential fence never disagrees between App and worker.
     */
    modelProvider: { ...modelProviderServerConfigDefinition },
  },
});

type WorkerConfigProjection = ConfigValue<typeof workerConfigDefinition>;

export type WorkerOutboundProxyConfig = Readonly<{
  https?: string;
  http?: string;
  noProxy?: string;
}>;

/**
 * One organization's own S3 (BYOC). All fields required together — a
 * half-configured route would fall back to the shared identity and write
 * one tenant's objects into another tenant's account.
 */
export type WorkerDataplaneS3Config = Readonly<{
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}>;

export type WorkerStorageConfig = Readonly<{
  backend: "azure" | "s3";
  localFilesystemRoot: string;
  /** Whether the Azure container has the trace spool's orphan-reaping rule. */
  azureSpoolRetentionConfirmed: boolean;
  s3: Readonly<{
    bucket?: string;
    endpoint?: string;
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
  }>;
  /** The Azure Blob account dataset chunks read and write through. */
  azure: Readonly<{
    backend: "azure" | "s3";
    authMode?: string;
    accountName?: string;
    accountKey?: string;
    container?: string;
    endpoint?: string;
    authorityHost?: string;
    tokenAudience?: string;
    allowInsecureTokenEndpointForTests: boolean;
    identity: Readonly<{
      tenantId?: string;
      clientId?: string;
      federatedTokenFile?: string;
    }>;
  }>;
  /**
   * Org id -> that org's own S3, keyed as the app keys it
   * (`DATAPLANE_S3__<label>__<organizationId>`) — read here rather than
   * declared per-tenant since there's no fixed set to declare.
   */
  dataplaneS3: ReadonlyMap<string, WorkerDataplaneS3Config>;
}>;

/**
 * `langwatchEndpoint` is where a prepared scenario child reports its own
 * run events — this deployment's ingestion origin, not the SDK default.
 */
export type WorkerExecutionConfig = Readonly<{
  langwatchEndpoint: string | undefined;
  defaultModel: string;
}>;

/**
 * `usageStats.disabled` folds in `IS_SAAS`: the hosted product reports
 * its own usage through a different path, so a second sender there would
 * double-count every organization.
 */
export type WorkerOpsConfig = Readonly<{
  usageStats: Readonly<{
    disabled: boolean;
    installMethod: string;
    hostname: string | undefined;
    environment: string | undefined;
  }>;
  /** Whether `system.backup_log` is read at all; ON unless deliberately off. */
  collectClickHouseBackupMetrics: boolean;
}>;

export type WorkerInfrastructureConfig = Readonly<{
  database: WorkerDatabaseConfig;
  execution: WorkerExecutionConfig;
  clickhouse: WorkerClickHouseConfig;
  redis: RedisConfigResolution;
  groupQueue: GroupQueuePolicy;
  storage: WorkerStorageConfig;
  outboundProxy: WorkerOutboundProxyConfig;
  modelProvider: WorkerModelProviderConfig;
}>;

/**
 * `isSaas` deliberately absent: it's `deployment.saas`, read there so one
 * variable keeps one meaning. What's here: the address fence a credential
 * probe is judged by, plus the env bag providers/Bedrock read keys from.
 */
export type WorkerModelProviderConfig = Readonly<{
  blockLocalHttpCalls: boolean;
  allowedProxyHosts: readonly string[];
  /**
   * The engine address, not the proxy path (that's the workflow feature's;
   * the composition root joins them) — keeps this module the process's
   * only environment reader.
   */
  nlpServiceUrl: string | undefined;
  /**
   * Raw env bag rather than named leaves on purpose: sixteen providers each
   * with their own keys, plus custom providers naming keys no schema here
   * could enumerate. Read here to keep this module the only env reader.
   */
  environment: Readonly<Record<string, string | undefined>>;
}>;

export type WorkerShutdownConfig = Readonly<{
  processDeadlineMs: number;
}>;

/** The command-lane counts the metric and log processing pipelines shard on. */
/** The worker's one HTTP listener. */
export type WorkerLivenessConfig = Readonly<{
  metricsPort: number;
  metricsToken: string | undefined;
}>;

export type WorkerProcessingConfig = Readonly<{
  metricShards?: string;
  logShards?: string;
  traceSpanShards?: string;
}>;

/** The Eventing substrate's own knobs, as this process resolved them. */
export type WorkerEventingConfig = Readonly<{
  foldCacheTtlSeconds?: number;
}>;

/** Which product this deployment is, resolved from the one shared variable. */
/** The one Postgres connection this process opens. */
export type WorkerDatabaseConfig = Readonly<{
  url: string | undefined;
}>;

/** The event store's endpoints, shared and per-organization. */
export type WorkerClickHouseConfig = Readonly<{
  url: string | undefined;
  privateRoutes: readonly Readonly<{ organizationId: string; url: string; cluster: string }>[];
  poolSizing: PoolSizingInput;
}>;

export type WorkerDeploymentConfig = Readonly<{
  saas: boolean;
  /** `ADMIN_EMAILS`; unset means nobody is a platform operator. */
  adminEmails: string | undefined;
  /**
   * `LANGWATCH_LICENSE_PUBLIC_KEY`; unset means the key embedded in the
   * licensing contract, which verifies every licence LangWatch issues.
   */
  licensePublicKey: string | undefined;
}>;

/** The Stripe credentials the SaaS monthly usage report is sent with. */
export type WorkerStripeConfig = Readonly<{
  secretKey?: string;
}>;

/**
 * `baseHost` sits beside the gateway rather than inside it: the gateway
 * decides how a message leaves, the host decides what it can link to —
 * neither is derivable from the other.
 */
export type WorkerMailConfig = Readonly<{
  baseHost: string;
  mailer: MailerConfiguration;
  /** Signs unsubscribe footer links and salts the no-reply tag; may be absent. */
  unsubscribeSigningSecret?: string;
}>;

/** Automation's own knobs, as this process read them. */
export type WorkerAutomationConfig = Readonly<{
  emailHourlyCap: number;
  tenantDailyCap: number;
  /** Absent on a deployment that stored no encrypted automation credentials. */
  credentialsEncryptionKey?: string;
  /**
   * All three carried even though only one is used: the tier is chosen by
   * an entitlement provider this process doesn't compose, and hiding the
   * unused numbers would hide that the choice exists.
   */
  persistDailyCapFree: number;
  persistDailyCapPaid: number;
  persistDailyCapEnterprise: number;
}>;

/**
 * Narrowed to the one required field. `.passthrough()` on purpose: the
 * whole document goes to the SDK, and dropping the key while keeping
 * `project_id` would build a client that authenticates with nothing.
 */
const googleDlpCredentialsSchema = z.object({ project_id: z.string().trim().min(1) }).passthrough();

export type GoogleDlpCredentials = z.infer<typeof googleDlpCredentialsSchema>;

export type GoogleDlpCredentialsFailure =
  | Readonly<{ reason: "invalid-json"; error: unknown }>
  | Readonly<{ reason: "missing-project-id"; error: z.ZodError }>;

/**
 * Projected the way `trace-privacy.config.ts` projects the same four vars.
 * `presidio.timeoutMs` is the app's own constant, not a fifth variable —
 * neither graph reads a timeout from the environment.
 */
export type WorkerTracePrivacyConfig = Readonly<{
  googleDlp: Readonly<{
    disabled: boolean;
    credentials: GoogleDlpCredentials | undefined;
  }>;
  presidio: Readonly<{ endpoint: string | undefined; timeoutMs: number }>;
  isProduction: boolean;
  nativePolicyEnforced: boolean;
}>;

/**
 * The tokenizer knobs this process estimates missing token counts under,
 * projected the way `platform/app/src/runtime/trace-privacy.config.ts` projects
 * the same two variables.
 */
export type WorkerTraceTokenizerConfig = Readonly<{
  bpeDirectory: string | undefined;
  fetchTimeoutMs: number;
}>;

/**
 * Copied from the app rather than tightened: a stricter parse here would
 * refuse a value the app accepts (booting one twin and not the other),
 * and a looser one would wait a different time for the same download.
 */
const DEFAULT_TIKTOKEN_FETCH_TIMEOUT_MS = 10_000;

export function resolveWorkerTraceTokenizerConfig(
  tokenizer: WorkerConfigProjection["tokenizer"],
): WorkerTraceTokenizerConfig {
  const raw = tokenizer.fetchTimeoutMs;
  const parsed = typeof raw === "number" ? raw : Number.parseInt(raw ?? "", 10);
  return {
    bpeDirectory: tokenizer.bpeDirectory,
    fetchTimeoutMs:
      Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIKTOKEN_FETCH_TIMEOUT_MS,
  };
}

/**
 * Both absent is a supported deployment, not a degraded one — it mirrors
 * the app's own behaviour when `POSTHOG_KEY` is unset (no analytics).
 */
export type WorkerProductAnalyticsConfig = Readonly<{
  key?: string;
  host?: string;
}>;

/**
 * "1" and nothing else — the app's own reading (compares raw value to
 * the string "1"), so `true`/`yes`/`TRUE` all mean off on both sides.
 */
export type WorkerWebhookConfig = Readonly<{
  allowInsecureLocalUrls: boolean;
  allowAmbientAwsCredentials: boolean;
}>;

/**
 * Absent exactly when neither variable is named. The pipeline still
 * mounts without it: a turn dispatched into no manager answers
 * `unavailable`, already treated as a failed (not lost) turn.
 */
export type WorkerLangyConfig = Readonly<{
  agentUrl: string;
  internalSecret: string;
}>;

/** The AI Gateway knobs this process resolves, carried unparsed on purpose. */
export type WorkerGatewayConfig = Readonly<{
  spendSettlementGraceMs?: string;
}>;

/** The GitHub App credentials the branch sweep mints installation tokens with. */
export type WorkerGithubConfig = Readonly<{
  appId?: string;
  privateKey?: string;
  host?: string;
}>;

/**
 * Same two fields `apps/api` projects, from the same vars by the same
 * rule — one deployment, one answer for the epoch cache and demo project.
 */
export type WorkerAuthzConfig = Readonly<{
  /** Whether an organization's permission reads may be served from the epoch cache. */
  epochCacheEnabled: boolean;
  /** The project every caller may read, where a deployment names one. */
  demoProjectId: string | undefined;
}>;

export type WorkerConfig = Readonly<{
  processRole: "worker";
  environment: string;
  nodeEnvironment: "development" | "test" | "production";
  serviceName: string;
  serviceVersion?: string;
  logger: WorkerConfigProjection["logger"];
  observability: WorkerConfigProjection["observability"];
  /**
   * This process serves an empty Prometheus exposition — every series
   * goes out over OTLP — so until an exporter is wired, its instruments
   * write into a no-op meter and the metrics exist nowhere.
   */
  otlpMetrics: OtlpMetricsExportOptions;
  shutdown: WorkerShutdownConfig;
  deployment: WorkerDeploymentConfig;
  /** Absent when the deployment named no `BASE_HOST`; see `resolveWorkerMailConfig`. */
  mail?: WorkerMailConfig;
  automation: WorkerAutomationConfig;
  authz: WorkerAuthzConfig;
  tracePrivacy: WorkerTracePrivacyConfig;
  /**
   * Projects the SAME `LANGEVALS_ENDPOINT` the privacy block also reads,
   * a second time rather than reusing it: two leaves over one variable
   * risk a future default answering the question differently.
   */
  langevals: Readonly<{ endpoint: string | undefined }>;
  tokenizer: WorkerTraceTokenizerConfig;
  stripe: WorkerStripeConfig;
  ops: WorkerOpsConfig;
  productAnalytics: WorkerProductAnalyticsConfig;
  gateway: WorkerGatewayConfig;
  webhooks: WorkerWebhookConfig;
  /** Absent when this deployment named no Langy agent manager. */
  langy?: WorkerLangyConfig;
  github: WorkerGithubConfig;
  processing: WorkerProcessingConfig;
  liveness: WorkerLivenessConfig;
  /** The event store's fallback retention, in days. */
  retention: Readonly<{ defaultDays: number }>;
  eventing: WorkerEventingConfig;
  infrastructure: WorkerInfrastructureConfig;
  /**
   * Resolved from the raw source, not the projection above: these are the
   * flags' own vocabulary (one var per flag, plus `FEATURE_FLAG_FORCE_ENABLE`).
   * No variable here that the app doesn't already read.
   */
  featureFlags: FeatureFlagConfig;
}>;

export function resolveWorkerConfig(source: Readonly<Record<string, unknown>>): WorkerConfig {
  const value = RuntimeConfig.create({
    name: "worker",
    definition: workerConfigDefinition,
    source: normalizeWorkerConfigSource(source),
  }).value;
  refuseWorkerSelfIngest(value);
  // Every rule that spans more than one leaf, refused here rather than at
  // first use: each one names a deployment that boots and then fails on a
  // job, which reads as an outage rather than as the mistake it is.
  assertAuthServerConfig(value.browserSession);
  assertBillingServerConfig(value.stripe);
  const mail = resolveWorkerMailConfig(value.mail, value.browserSession.sessionSecret);
  const langy = resolveWorkerLangyConfig(value.langy);

  return {
    processRole: value.processRole,
    environment: value.environment,
    nodeEnvironment: value.nodeEnvironment,
    serviceName: value.serviceName,
    serviceVersion: value.serviceVersion,
    logger: value.logger,
    observability: value.observability,
    otlpMetrics: otlpMetricsExportOptionsFrom({
      telemetry: resolveTelemetryConfiguration(source),
      serviceName: value.serviceName,
    }),
    shutdown: resolveWorkerShutdownConfig({
      nodeEnvironment: value.nodeEnvironment,
      environment: value.environment,
      queueDrainTimeoutMs: value.shutdown.queueDrainTimeoutMs,
    }),
    deployment: value.deployment,
    ...(mail ? { mail } : {}),
    automation: resolveWorkerAutomationConfig(
      value.automation,
      value.secret.encryptionKey ?? value.browserSession.sessionSecret,
    ),
    authz: value.authz,
    tracePrivacy: resolveWorkerTracePrivacyConfig({
      tracePrivacy: value.tracePrivacy,
      langevalsEndpoint: value.evaluation.langevalsEndpoint,
      nodeEnvironment: value.nodeEnvironment,
    }),
    langevals: { endpoint: value.evaluation.langevalsEndpoint },
    tokenizer: resolveWorkerTraceTokenizerConfig(value.trace.tokenizer),
    stripe: { secretKey: value.stripe.stripeSecretKey },
    ops: {
      usageStats: {
        // Two switches, one meaning: an operator who opted out and the hosted
        // product, which reports its own usage by another path.
        disabled: value.ops.usageStats.disabled || value.deployment.saas,
        // Self-hosted is the default because a deployment that named no method
        // installed itself, which is what the receiver records it as.
        installMethod: value.ops.usageStats.installMethod?.trim() || "self-hosted",
        hostname: value.mail.baseHost?.trim() || undefined,
        environment: value.nodeEnvironment,
      },
      collectClickHouseBackupMetrics: value.ops.collectClickHouseBackupMetrics,
    },
    productAnalytics: value.ops.productAnalytics,
    gateway: value.gateway,
    webhooks: value.webhooks,
    ...(langy ? { langy } : {}),
    github: value.github,
    processing: { ...value.processing, traceSpanShards: value.trace.spanProcessingShards },
    liveness: {
      metricsPort: resolveWorkerMetricsPort(value.liveness.metricsPort),
      metricsToken: value.ops.metricsApiKey,
    },
    retention: {
      defaultDays: resolvePlatformDefaultRetentionDays({
        LANGWATCH_DEFAULT_RETENTION_DAYS: value.retention.platformDefaultDays,
        NODE_ENV: value.nodeEnvironment,
      }),
    },
    eventing: value.eventing,
    infrastructure: {
      database: { url: value.infrastructure.database.url },
      execution: {
        // The SAME variable this process's own telemetry is exported to, read
        // once and projected here: a prepared scenario child reports its run
        // events to the deployment's own collector.
        langwatchEndpoint: value.observability.endpoint?.trim() || undefined,
        // A blank override is not a model. It resolves to the registry
        // flagship rather than to an empty string, which a child would carry
        // to the provider as a model named "".
        defaultModel: value.infrastructure.modelProvider.defaultModel ?? REGISTRY_FLAGSHIP_MODEL,
      },
      clickhouse: {
        url: value.infrastructure.clickhouse.url?.trim() || undefined,
        privateRoutes: resolveWorkerPrivateClickHouseRoutes(source),
        poolSizing: poolSizingFromEnv(environmentStrings(source)),
      },
      redis: new RedisConfigService().resolve(value.infrastructure.redis),
      groupQueue: resolveGroupQueuePolicyFromEnv(value.infrastructure.groupQueue),
      storage: {
        backend: value.infrastructure.storage.backend ?? "s3",
        localFilesystemRoot:
          value.infrastructure.storage.localFilesystemRoot ?? DEFAULT_LOCAL_STORAGE_ROOT,
        azureSpoolRetentionConfirmed: value.infrastructure.storage.azureSpoolRetentionConfirmed,
        s3: {
          ...value.infrastructure.storage.s3,
          region: resolveS3Region(value.infrastructure.storage.s3),
          // The shared object-storage block carries these three as raw,
          // untrimmed leaves (its s3 credential shape is the same one
          // `apps/api` reads); this process trims blank-to-undefined itself,
          // which is what the block's own dedicated `optionalEnvironmentSecret`
          // transform used to do before the leaf moved into `@langwatch/config`.
          accessKeyId: value.infrastructure.storage.s3.accessKeyId?.trim() || undefined,
          secretAccessKey: value.infrastructure.storage.s3.secretAccessKey?.trim() || undefined,
          sessionToken: value.infrastructure.storage.s3.sessionToken?.trim() || undefined,
        },
        azure: {
          backend: value.infrastructure.storage.backend ?? "s3",
          authMode: value.infrastructure.storage.azure.authMode?.trim() || undefined,
          accountName: value.infrastructure.storage.azure.accountName?.trim() || undefined,
          accountKey: value.infrastructure.storage.azure.accountKey?.trim() || undefined,
          container: value.infrastructure.storage.azure.container?.trim() || undefined,
          endpoint: value.infrastructure.storage.azure.endpoint?.trim() || undefined,
          authorityHost: value.infrastructure.storage.azure.authorityHost?.trim() || undefined,
          tokenAudience: value.infrastructure.storage.azure.tokenAudience?.trim() || undefined,
          // Refused outright in production, matching the App's own guard: a
          // real deployment cannot put a bearer token on the wire in
          // plaintext no matter who sets the escape hatch.
          allowInsecureTokenEndpointForTests:
            value.nodeEnvironment !== "production" &&
            value.infrastructure.storage.azure.allowInsecureTokenEndpointForTests?.trim() === "1",
          identity: {
            tenantId: value.infrastructure.storage.azure.identity.tenantId?.trim() || undefined,
            clientId: value.infrastructure.storage.azure.identity.clientId?.trim() || undefined,
            federatedTokenFile:
              value.infrastructure.storage.azure.identity.federatedTokenFile?.trim() || undefined,
          },
        },
        dataplaneS3: resolveWorkerDataplaneS3Config(source),
      },
      outboundProxy: value.infrastructure.outboundProxy,
      modelProvider: resolveWorkerModelProviderConfig(
        value.infrastructure.modelProvider,
        environmentStrings(source),
      ),
    },
    featureFlags: resolveFeatureFlagConfig(source),
  };
}

/**
 * Narrows the predecessor's blanket `LANGWATCH_API_KEY` refusal to true
 * self-ingestion only, since exporting to a DIFFERENT install is supported.
 * `NEXTAUTH_URL` names this deployment's own front door.
 */
function refuseWorkerSelfIngest(value: WorkerConfigProjection): void {
  assertObservabilityDoesNotSelfIngest({
    runtime: "worker",
    apiKeyEnv: "LANGWATCH_API_KEY",
    apiKey: value.observability.apiKey,
    endpointEnv: "LANGWATCH_ENDPOINT",
    endpoint: value.observability.endpoint,
    deployment: [
      { env: "BASE_HOST", value: value.mail.baseHost },
      { env: "NEXTAUTH_URL", value: value.browserSession.sessionUrl },
    ],
  });
}

/**
 * Refused TOGETHER, at the app's own spelling of the refusal: a URL
 * without a secret would dispatch every turn unauthenticated.
 */
function resolveWorkerLangyConfig(
  langy: WorkerConfigProjection["langy"],
): WorkerLangyConfig | undefined {
  const agentUrl = langy.agentUrl?.trim();
  const internalSecret = langy.internalSecret?.trim();
  // An address without a secret never gets here: the schema refuses it.
  if (!agentUrl || !internalSecret) return undefined;

  return { agentUrl, internalSecret };
}

/**
 * Nothing exactly when `BASE_HOST` is absent/blank — every link and the
 * sender address derive from it. What an absent capability costs is
 * decided by the caller, not here.
 */
function resolveWorkerMailConfig(
  mail: WorkerConfigProjection["mail"],
  nextauthSecret: string | undefined,
): WorkerMailConfig | undefined {
  const baseHost = mail.baseHost?.trim();
  if (!baseHost) return undefined;

  const unsubscribeSigningSecret = nextauthSecret;

  return {
    baseHost,
    ...(unsubscribeSigningSecret === undefined ? {} : { unsubscribeSigningSecret }),
    mailer: {
      defaultFrom: EmailProviderService.resolveDefaultFrom({
        emailDefaultFrom: mail.defaultFrom,
        baseHost,
      }),
      provider: mail.provider,
      ses: {
        enabled: Boolean(mail.ses.enabled),
        region: mail.ses.region,
        endpoint: mail.ses.endpoint,
      },
      sendgrid: { apiKey: mail.sendgrid.apiKey },
      smtp: {
        url: mail.smtp.url,
        host: mail.smtp.host,
        port: mail.smtp.port,
        user: mail.smtp.user,
        password: mail.smtp.password,
        secure: mail.smtp.secure,
      },
      resend: { apiKey: mail.resend.apiKey },
    },
  };
}

/**
 * `CREDENTIALS_SECRET` then `NEXTAUTH_SECRET`, matching
 * `utils/encryption.ts`'s own order — rows were written by whichever it
 * found. Neither present is valid: nothing was ever encrypted.
 */
function resolveWorkerAutomationConfig(
  automation: WorkerConfigProjection["automation"],
  storedSecretKey: string | undefined,
): WorkerAutomationConfig {
  const credentialsEncryptionKey = storedSecretKey?.trim();

  return {
    emailHourlyCap: automation.emailHourlyCap,
    tenantDailyCap: automation.tenantDailyCap,
    ...(credentialsEncryptionKey ? { credentialsEncryptionKey } : {}),
    persistDailyCapFree: automation.persistDailyCapFree,
    persistDailyCapPaid: automation.persistDailyCapPaid,
    persistDailyCapEnterprise: automation.persistDailyCapEnterprise,
  };
}

/**
 * Invalid service-account JSON preserves the app's old degrade-to-
 * unavailable behaviour rather than failing an unrelated boot — DLP is
 * only a Presidio-outage fallback. Reported to the caller so a boot can log it.
 */
export function resolveWorkerTracePrivacyConfig(
  input: {
    tracePrivacy: WorkerConfigProjection["tracePrivacy"];
    langevalsEndpoint: string | undefined;
    nodeEnvironment: WorkerConfigProjection["nodeEnvironment"];
  },
  onInvalidCredentials: (failure: GoogleDlpCredentialsFailure) => void = () => undefined,
): WorkerTracePrivacyConfig {
  let credentials: GoogleDlpCredentials | undefined;

  if (input.tracePrivacy.googleApplicationCredentials) {
    try {
      const parsedCredentials = JSON.parse(input.tracePrivacy.googleApplicationCredentials);
      const validatedCredentials = googleDlpCredentialsSchema.safeParse(parsedCredentials);
      if (validatedCredentials.success) {
        credentials = validatedCredentials.data;
      } else {
        onInvalidCredentials({ reason: "missing-project-id", error: validatedCredentials.error });
      }
    } catch (error) {
      onInvalidCredentials({ reason: "invalid-json", error });
    }
  }

  return {
    googleDlp: {
      disabled:
        input.tracePrivacy.googleDlpDisabled === true ||
        input.tracePrivacy.googleDlpDisabled === "true",
      credentials,
    },
    presidio: {
      endpoint: input.langevalsEndpoint,
      timeoutMs: DEFAULT_PRESIDIO_TIMEOUT_MS,
    },
    isProduction: input.nodeEnvironment === "production",
    nativePolicyEnforced: input.tracePrivacy.enforcement !== "off",
  };
}

function normalizeWorkerConfigSource(
  source: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return {
    ...source,
    WORKER_SERVICE_NAME: source.WORKER_SERVICE_NAME ?? source.OTEL_SERVICE_NAME,
    LOG_LEVEL: source.LOG_LEVEL ?? source.PINO_LOG_LEVEL ?? source._LOG_LEVEL,
    LOG_CONSOLE_LEVEL: source.LOG_CONSOLE_LEVEL ?? source.PINO_CONSOLE_LEVEL,
    LOG_OTEL_EXPORT_ENABLED: source.LOG_OTEL_EXPORT_ENABLED ?? source.PINO_OTEL_ENABLED,
    HTTPS_PROXY: source.HTTPS_PROXY ?? source.https_proxy,
    HTTP_PROXY: source.HTTP_PROXY ?? source.http_proxy,
    NO_PROXY: source.NO_PROXY ?? source.no_proxy,
  };
}

function resolveS3Region(
  s3: WorkerConfigProjection["infrastructure"]["storage"]["s3"],
): string | undefined {
  if (s3.region !== undefined) return s3.region;

  const hasExplicitCredentials = Boolean(s3.accessKeyId && s3.secretAccessKey);
  const isAwsEndpoint = !s3.endpoint || s3.endpoint.endsWith(".amazonaws.com");
  return isAwsEndpoint && !hasExplicitCredentials ? undefined : "auto";
}

function resolveWorkerShutdownConfig(input: {
  nodeEnvironment: WorkerConfigProjection["nodeEnvironment"];
  environment: WorkerConfigProjection["environment"];
  queueDrainTimeoutMs: WorkerConfigProjection["shutdown"]["queueDrainTimeoutMs"];
}): WorkerShutdownConfig {
  const defaultDrainMs =
    input.nodeEnvironment === "development" || input.environment === "local"
      ? DEFAULT_DEVELOPMENT_QUEUE_DRAIN_MS
      : DEFAULT_PRODUCTION_QUEUE_DRAIN_MS;
  const parsed = Number(input.queueDrainTimeoutMs);
  const queueDrainMs = Number.isFinite(parsed) && parsed > 0 ? parsed : defaultDrainMs;
  return { processDeadlineMs: queueDrainMs + APP_CLOSE_SLACK_MS + PROCESS_CLOSE_SLACK_MS };
}

/**
 * Parsed by the shared helper, not a second reader: variable names carry
 * the org id, so splitting them differently from the API would write a
 * customer's objects where that customer can't read them.
 */
export function resolveWorkerDataplaneS3Config(
  source: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, WorkerDataplaneS3Config> {
  return parseDataplaneS3RoutingTable(source).routes;
}

/**
 * Parsed by the shared helper: variable names carry the org id, and
 * splitting them differently from the app would route one org's folds
 * to another org's cluster.
 */
function resolveWorkerPrivateClickHouseRoutes(
  source: Readonly<Record<string, unknown>>,
): readonly Readonly<{ organizationId: string; url: string; cluster: string }>[] {
  const table = parseRoutingTable(environmentStrings(source));
  return [...table.routes].map(([organizationId, url]) => ({
    organizationId,
    url,
    cluster: organizationId,
  }));
}

/** The environment bag as the shared ClickHouse helpers read it. */
/** Every reading is the feature's own; this only adds the process's env bag. */
function resolveWorkerModelProviderConfig(
  value: Readonly<{
    blockLocalHttpCalls: boolean;
    allowedProxyHosts: readonly string[];
    nlpServiceUrl: string | undefined;
  }>,
  environment: Readonly<Record<string, string | undefined>>,
): WorkerModelProviderConfig {
  return {
    blockLocalHttpCalls: value.blockLocalHttpCalls,
    allowedProxyHosts: value.allowedProxyHosts,
    nlpServiceUrl: value.nlpServiceUrl,
    environment,
  };
}

function environmentStrings(
  source: Readonly<Record<string, unknown>>,
): Record<string, string | undefined> {
  const strings: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(source)) {
    if (typeof value === "string") strings[name] = value;
  }
  return strings;
}

/** The chart's probe port; overridable, and refused rather than coerced. */
export const DEFAULT_WORKER_METRICS_PORT = 2999;

function resolveWorkerMetricsPort(value: string | undefined): number {
  if (value === undefined || value === "") return DEFAULT_WORKER_METRICS_PORT;
  const port = Number.parseInt(value, 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid WORKER_METRICS_PORT: "${value}". Must be a number between 1 and 65535.`,
    );
  }
  return port;
}
