import {
  assertObservabilityDoesNotSelfIngest,
  Config,
  environmentBooleanSchema,
  environmentOneOrTrueSchema,
  parseDataplaneS3RoutingTable,
  resolveTelemetryConfiguration,
  RuntimeConfig,
  type ConfigValue,
} from "@langwatch/config";
import {
  otlpMetricsExportOptionsFrom,
  type OtlpMetricsExportOptions,
} from "@langwatch/observability/node";
import {
  parseRoutingTable,
  poolSizingFromEnv,
  type PoolSizingInput,
} from "@langwatch/clickhouse-client";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "@langwatch/data-retention-contract";
import { resolveFeatureFlagConfig, type FeatureFlagConfig } from "@langwatch/feature-flag-contract";
import { resolveGroupQueuePolicyFromEnv, type GroupQueuePolicy } from "@langwatch/group-queue";
import { EmailProviderService, type MailerConfiguration } from "@langwatch/notification-server";
import { RedisConfigService, type RedisConfigResolution } from "@langwatch/redis-client";
import { z } from "zod";

const DEFAULT_LOCAL_STORAGE_ROOT = "/var/lib/langwatch/objects";
const DEFAULT_PRODUCTION_QUEUE_DRAIN_MS = 25_000;
const DEFAULT_DEVELOPMENT_QUEUE_DRAIN_MS = 5_000;
const APP_CLOSE_SLACK_MS = 5_000;
/** The application's own Presidio ceiling; neither graph reads it from the environment. */
const DEFAULT_PRESIDIO_TIMEOUT_MS = 60_000;
const PROCESS_CLOSE_SLACK_MS = 15_000;

const optionalEnvironmentString = z.string().optional();

/** Empty credentials mean that the AWS SDK's default provider chain is in use. */
const optionalEnvironmentSecret = optionalEnvironmentString.transform((value) =>
  value?.trim() ? value : undefined,
);

const optionalProxyValue = optionalEnvironmentString.transform((value) => {
  const trimmed = value?.trim();
  return trimmed || undefined;
});

export const workerConfigDefinition = RuntimeConfig.define({
  /** A standalone worker owns background consumer behaviour once installed. */
  processRole: Config.value(z.literal("worker").default("worker"), { env: "WORKER_PROCESS_ROLE" }),
  environment: Config.value(z.string().min(1).default("local"), { env: "ENVIRONMENT" }),
  nodeEnvironment: Config.value(
    z.enum(["development", "test", "production"]).default("development"),
    {
      env: "NODE_ENV",
    },
  ),
  serviceName: Config.value(z.string().min(1).default("langwatch:worker"), {
    env: "WORKER_SERVICE_NAME",
  }),
  serviceVersion: Config.value(z.string().min(1).optional(), {
    env: "SERVICE_VERSION",
  }),
  logger: {
    format: Config.value(z.enum(["pretty", "json"]).optional(), { env: "LOG_FORMAT" }),
    level: Config.value(z.string().min(1).optional(), { env: "LOG_LEVEL" }),
    consoleLevel: Config.value(z.string().min(1).optional(), { env: "LOG_CONSOLE_LEVEL" }),
    otelExportEnabled: Config.value(environmentBooleanSchema.optional(), {
      env: "LOG_OTEL_EXPORT_ENABLED",
    }),
  },
  observability: {
    apiKey: Config.secret({ optional: true, env: "LANGWATCH_API_KEY" }),
    endpoint: Config.url({ optional: true, env: "LANGWATCH_ENDPOINT" }),
    processorType: Config.value(z.enum(["simple", "batch"]).default("batch"), {
      env: "LANGWATCH_PROCESSOR_TYPE",
    }),
  },
  shutdown: {
    queueDrainTimeoutMs: Config.value(optionalEnvironmentString, {
      env: "SHUTDOWN_DRAIN_TIMEOUT_MS",
    }),
  },
  /**
   * The GitHub App this instance is, if it is one.
   *
   * Optional in exactly the way the application's own environment schema has
   * it: a deployment without a GitHub App still runs pull-request linkage
   * retention, and a standalone worker has to be able to boot without one.
   */
  github: {
    appId: Config.value(optionalEnvironmentString, { env: "GITHUB_LANGY_APP_ID" }),
    privateKey: Config.secret({ optional: true, env: "GITHUB_LANGY_PRIVATE_KEY" }),
    host: Config.value(optionalEnvironmentString, { env: "GITHUB_LANGY_HOST" }),
  },
  /**
   * Which product this deployment is, as the one variable both graphs read.
   *
   * The App gates its cross-pipeline billable-events meter on `config.isSaas`
   * and this process gates its own on this leaf, and the pair's `global:*`
   * routing keys share `event-sourcing/jobs` with every pipeline's. Two graphs
   * that disagreed would not fail loudly: a consumer without the pair rejects
   * every billable span, evaluation, experiment and simulation event for
   * redelivery forever, and a consumer that has it where the producer does not
   * meters a self-hosted install into a table nobody bills from.
   *
   * `environmentOneOrTrueSchema` is the App's own reading of the variable,
   * spelling for spelling; see its frozen-twin note in `@langwatch/config`.
   */
  deployment: {
    saas: Config.value(environmentOneOrTrueSchema, { env: "IS_SAAS" }),
    /**
     * The deployment's operator list, read at the App's own spelling.
     *
     * It is what already decides who reaches the back office, and the SSO
     * connection guards refuse an organization administrator's hand on the
     * strength of it (ADR-117 D05 tier 1). Unset means nobody, which is the
     * fail-closed answer the back office also takes — so a worker that read a
     * different list than the App would let a domain attestation land through
     * one surface that the other refuses.
     */
    adminEmails: Config.value(optionalEnvironmentString, { env: "ADMIN_EMAILS" }),
    /**
     * The key an activated Enterprise licence's signature is checked against.
     *
     * Optional, and absent is the normal case: the licensing contract embeds
     * the production public key, so a deployment verifies every licence
     * LangWatch issues without configuring anything. The variable exists for
     * ROTATION, and it is the App's own spelling because plan resolution runs
     * in BOTH processes (ADR-027) — a worker checking a signature against a
     * different key than the App is one deployment with two answers to whether
     * it is licensed at all. Blank is not a key, so it resolves to nothing
     * rather than to an empty string that would refuse every licence.
     */
    licensePublicKey: Config.value(optionalEnvironmentString, {
      env: "LANGWATCH_LICENSE_PUBLIC_KEY",
    }),
  },
  /**
   * The Stripe secret the monthly usage report is sent with.
   *
   * Optional in exactly the way the application's own environment schema has
   * it, and read from the same variable. A self-hosted worker composes no
   * sender and never asks for one; a SaaS worker resolves one and refuses to
   * compose without a key, which is the refusal the App already makes at
   * `AppStripeRuntime.create`. A SaaS process that metered without a sender
   * would count every billable event correctly and report none of them.
   */
  stripe: {
    secretKey: Config.secret({ optional: true, env: "STRIPE_SECRET_KEY" }),
  },
  /**
   * The PostHog project this deployment's product analytics belong to.
   *
   * Both variables are the application's own spelling and its own parse
   * (`POSTHOG_KEY` and `POSTHOG_HOST` in `platform/app/src/env-create.mjs`, each
   * `z.string().optional()`), because the ingest path's one product event —
   * `first_trace_integrated`, the terminal step of the onboarding funnel — is
   * emitted by whichever graph owns the trace pipeline, and the funnel is one
   * funnel. A worker pointed at a different project would file the milestone
   * where nobody reads it, and a worker holding no key at all would undercount
   * the funnel on the deployment that paid for the analytics.
   *
   * `Config.value` rather than `Config.secret` on BOTH counts. A PostHog
   * project key is write-only and already public — `apps/ui` serves it to the
   * browser as public configuration — so it is not a secret; and
   * `Config.secret` is `z.string().min(1)`, which REFUSES `POSTHOG_KEY=` where
   * the application accepts it and quietly runs without analytics. A worker
   * that would not boot on an environment its twin boots on is the drift.
   *
   * `host` has NO default here because it has none there: the application
   * passes `env.POSTHOG_HOST` straight into the client, so an unset variable
   * means the vendor's own default on both sides. Inventing one here would be
   * a second answer to which region the events land in.
   */
  productAnalytics: {
    key: Config.value(optionalEnvironmentString, { env: "POSTHOG_KEY" }),
    host: Config.value(optionalEnvironmentString, { env: "POSTHOG_HOST" }),
  },
  /**
   * The one outbound mail gateway this process sends through.
   *
   * Every variable below is the application's own spelling
   * (`platform/app/src/runtime/app/mailer.private-config.ts`), because both
   * graphs still send while the pipelines are twinned: a reminder that left
   * this process from a different sender domain than the same reminder leaving
   * the App would fail one deployment's SPF and pass the other's, and the half
   * that failed is the half nobody is watching.
   *
   * `BASE_HOST` is what makes the whole leaf resolvable or not. Every mail this
   * process sends carries a link back to the deployment, and the sender address
   * a deployment did not name is derived from the same host — so a worker
   * without it cannot compose a delivery capability at all, rather than
   * composing one that sends mail nobody can act on. What that absence costs is
   * decided by the graph, not here: see `resolveWorkerMailConfig`.
   *
   * The gateway settings themselves stay optional. A deployment with no email
   * provider configured is an ordinary self-hosted install: it composes, mounts
   * every pipeline, and fails at the moment of a send, which the notification
   * fan-outs survive because the durable fact is the request and never the
   * courtesy.
   */
  mail: {
    baseHost: Config.value(optionalEnvironmentString, { env: "BASE_HOST" }),
    defaultFrom: Config.value(optionalEnvironmentString, { env: "EMAIL_DEFAULT_FROM" }),
    provider: Config.value(optionalEnvironmentString, { env: "EMAIL_PROVIDER" }),
    ses: {
      // Presence-based, exactly as the App reads it: existing deployments treat
      // USE_AWS_SES=false as enabled, and changing that would select a
      // different gateway at send time in one process and not the other.
      enabled: Config.value(optionalEnvironmentString, { env: "USE_AWS_SES" }),
      region: Config.value(optionalEnvironmentString, { env: "AWS_REGION" }),
      endpoint: Config.value(optionalEnvironmentString, { env: "AWS_SES_ENDPOINT" }),
    },
    sendgrid: {
      apiKey: Config.secret({ optional: true, env: "SENDGRID_API_KEY" }),
    },
    smtp: {
      url: Config.secret({ optional: true, env: "SMTP_URL" }),
      host: Config.value(optionalEnvironmentString, { env: "SMTP_HOST" }),
      port: Config.value(optionalEnvironmentString, { env: "SMTP_PORT" }),
      user: Config.value(optionalEnvironmentString, { env: "SMTP_USER" }),
      password: Config.secret({ optional: true, env: "SMTP_PASSWORD" }),
      secure: Config.value(optionalEnvironmentString, { env: "SMTP_SECURE" }),
    },
    resend: {
      apiKey: Config.secret({ optional: true, env: "RESEND_API_KEY" }),
    },
  },
  /**
   * What the graph-alert half of Automation needs that is not a transport.
   *
   * The two ceilings are read from the application's own variables, with the
   * application's own defaults, because both graphs count into ONE Redis
   * keyspace while the pipelines are twinned: two processes with different
   * hourly ceilings for the same automation would let the higher one spend the
   * budget the lower one was protecting, and the customer would see a burst
   * from one pod and silence from the next.
   *
   * `credentialsEncryptionKey` is the at-rest key a stored Slack bot token and
   * a stored webhook secret were written under, read with the application's own
   * precedence (`CREDENTIALS_SECRET`, then `NEXTAUTH_SECRET`) — the same pair
   * the API executable resolves. A process holding the wrong one composes
   * perfectly and then fails to decrypt the first credential it needs, which is
   * why it is resolved at boot rather than at the first alert.
   */
  /**
   * The application's `NEXTAUTH_SECRET`, which two unrelated things still rest
   * on and which is therefore read once, here, rather than twice under the
   * names of its uses.
   *
   * It SIGNS every unsubscribe footer link (ADR-031) — a link this process
   * mints is verified months later by the application's public `/unsubscribe`
   * route, out of somebody's inbox, so a second key would 404 every link the
   * other half signed — and it is the ENCRYPTION key stored automation
   * credentials fall back to when `CREDENTIALS_SECRET` is absent, because
   * `platform/app/src/utils/encryption.ts` reads the pair in that order and
   * the rows were written by whichever it found.
   *
   * The legacy empty-string value is kept as the application keeps it: the
   * token signer refuses an empty key at the security boundary, while the
   * no-reply tag deliberately degrades instead.
   */
  nextauthSecret: Config.value(optionalEnvironmentString, { env: "NEXTAUTH_SECRET" }),
  /**
   * The two AuthZ switches, read raw and interpreted below.
   *
   * Read at the API tier's exact spellings and with its exact rule, because
   * both answer a question that must have ONE answer across the fleet.
   * `AUTHZ_EPOCH_CACHE` is a legacy opt-in the platform app reads as "1 or
   * true, anything else off", and two processes disagreeing about whether a
   * permission read may be served from the epoch cache is worse than either
   * answer. `DEMO_PROJECT_ID` names the one project everybody may read; blank
   * is not a project id, so a blank export means no demo project rather than a
   * project whose id is the empty string — a filter on `""` widens rather than
   * narrows.
   *
   * The demo project's OWNING user is deliberately not read here. It is
   * attribution for work the demo project does on a request path, and this
   * process serves none.
   */
  authz: {
    epochCache: Config.value(optionalEnvironmentString, { env: "AUTHZ_EPOCH_CACHE" }),
    demoProjectId: Config.value(optionalEnvironmentString, { env: "DEMO_PROJECT_ID" }),
  },
  automation: {
    emailHourlyCap: Config.value(z.coerce.number().int().positive().default(100), {
      env: "TRIGGER_EMAIL_HOURLY_CAP",
    }),
    tenantDailyCap: Config.value(z.coerce.number().int().positive().default(10000), {
      env: "TRIGGER_EMAIL_TENANT_DAILY_CAP",
    }),
    credentialsEncryptionKey: Config.secret({ optional: true, env: "CREDENTIALS_SECRET" }),
    /**
     * The daily ceiling on CONFIRMED persist-class matches, per project.
     *
     * Three numbers rather than one because the tier comes from the
     * organization's active plan, which this process now resolves for itself
     * whenever it opened a typed Prisma client. A graph without one settles on
     * the paid number and says so by name.
     *
     * **The defaults are the interactive process's own numbers**, because the
     * ceiling is a FLEET fact and the customer reads it from the other half:
     * `automation.persistCapUsage` answers the automations screen with the cap
     * this project resolves to, and a worker enforcing a different one either
     * skips matches the screen said were allowed or lets through matches it
     * said were not. They stayed 100/1000/10000 for as long as the ceiling here
     * was a flat fallback nobody could compare against.
     */
    persistDailyCapFree: Config.value(z.coerce.number().int().positive().default(50), {
      env: "TRIGGER_PERSIST_DAILY_CAP_FREE",
    }),
    persistDailyCapPaid: Config.value(z.coerce.number().int().positive().default(500), {
      env: "TRIGGER_PERSIST_DAILY_CAP_PAID",
    }),
    persistDailyCapEnterprise: Config.value(z.coerce.number().int().positive().default(5000), {
      env: "TRIGGER_PERSIST_DAILY_CAP_ENTERPRISE",
    }),
  },
  /**
   * What the trace, log and metric ingestion paths need to redact personal
   * data, read from the application's own four variables.
   *
   * These four decide WHETHER content is scrubbed and BY WHAT, so a process
   * holding a different answer than the one beside it does not fail — it
   * stores the span with the personal data still in it. `LANGEVALS_ENDPOINT`
   * absent means the strict analyzer cannot run at all, which is fatal in
   * production and a marked-incomplete span everywhere else;
   * `LANGWATCH_DATA_PRIVACY_ENFORCEMENT=off` is the kill switch that sends
   * every span down the analysis-service path with no native floor;
   * `LANGWATCH_DISABLE_GOOGLE_DLP` and `GOOGLE_APPLICATION_CREDENTIALS`
   * together decide whether the DLP fallback exists when Presidio is down.
   *
   * The credentials are carried as the raw document, unparsed, exactly as the
   * application carries them: `resolveWorkerTracePrivacyConfig` owns the parse
   * and keeps the application's deliberate behaviour of leaving DLP
   * unavailable after invalid JSON rather than failing an unrelated boot.
   */
  tracePrivacy: {
    googleApplicationCredentials: Config.secret({
      optional: true,
      env: "GOOGLE_APPLICATION_CREDENTIALS",
    }),
    /**
     * Carried as the application carries it — a raw boolean-or-string, not a
     * parsed boolean. `environmentBooleanSchema` would disagree with the
     * application twice: it reads `"1"` as true, which the application reads
     * as false, and it REFUSES any other spelling, which would turn
     * `LANGWATCH_DISABLE_GOOGLE_DLP=yes` from "DLP stays available" into a
     * process that will not boot.
     */
    googleDlpDisabled: Config.value(z.union([z.boolean(), z.string()]).optional(), {
      env: "LANGWATCH_DISABLE_GOOGLE_DLP",
    }),
    langevalsEndpoint: Config.value(optionalEnvironmentString, {
      env: "LANGEVALS_ENDPOINT",
    }),
    dataPrivacyEnforcement: Config.value(optionalEnvironmentString, {
      env: "LANGWATCH_DATA_PRIVACY_ENFORCEMENT",
    }),
  },
  /**
   * Where this process finds the BPE tables it counts tokens with, and how long
   * it will wait to fetch one it has not got.
   *
   * The App reads these two in the same projection as the four privacy
   * variables (`platform/app/src/runtime/trace-privacy.config.ts`), but they
   * decide a different thing — whether a span that arrived without usage
   * attributes gets estimated ones — so they are their own leaf here.
   *
   * The timeout is carried as a raw string-or-number, not a coerced number.
   * `z.coerce.number()` refuses `TIKTOKEN_FETCH_TIMEOUT_MS=10s`, where the App
   * reads it as 10 through `Number.parseInt` and carries on; and it accepts
   * `-1`, where the App falls back to the default. `resolveWorkerTraceTokenizerConfig`
   * owns the parse so both processes wait the same number of milliseconds.
   */
  tokenizer: {
    bpeDirectory: Config.value(optionalEnvironmentString, { env: "TIKTOKENS_PATH" }),
    fetchTimeoutMs: Config.value(z.union([z.string(), z.number()]).optional(), {
      env: "TIKTOKEN_FETCH_TIMEOUT_MS",
    }),
  },
  /**
   * The two unsafe opt-ins the webhook endpoint policy reads.
   *
   * Both default OFF and both are read at the App's own spellings, because
   * they decide what a customer is ALLOWED to point an endpoint at: a
   * deployment that answered differently in the two processes would accept an
   * endpoint through one surface and refuse to deliver it from the other.
   */
  webhooks: {
    allowInsecureLocalUrls: Config.value(optionalEnvironmentString, {
      env: "WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS",
    }),
    allowAmbientAwsCredentials: Config.value(optionalEnvironmentString, {
      env: "WEBHOOKS_UNSAFE_ALLOW_AMBIENT_CREDENTIALS",
    }),
  },
  /**
   * Where this process reaches the Langy agent manager, and the secret it
   * presents to it.
   *
   * Read from the App's own two variables, and refused TOGETHER the way
   * `resolveLangyWorkerConfig` refuses them: a URL without a secret dispatches
   * every turn unauthenticated, and a secret without a URL dispatches nowhere.
   * Both absent is a deployment that runs no agent manager, which is a named
   * absence rather than a failure.
   */
  langy: {
    agentUrl: Config.value(optionalEnvironmentString, { env: "OPENCODE_AGENT_URL" }),
    internalSecret: Config.secret({ optional: true, env: "LANGY_INTERNAL_SECRET" }),
  },
  /**
   * The AI Gateway knobs this process resolves for the pipelines it consumes.
   *
   * The raw string is carried rather than a number: `settlementGraceMs` in
   * `@langwatch/gateway-server` owns the parse, its bound and the warning it
   * logs, and the REST settlement policy the App serves calls the same
   * function on the same variable. Parsing here as well is how the two ends of
   * one grace window drift apart.
   */
  gateway: {
    spendSettlementGraceMs: Config.value(optionalEnvironmentString, {
      env: "LW_SPEND_SETTLEMENT_GRACE_MS",
    }),
  },
  /**
   * How many ordered lanes the metric and log command paths spread across.
   *
   * Read from the same two variables the App reads, and resolved by the same
   * two functions, because the App produces into these pipelines while this
   * process consumes them: two graphs that clamped a lane count differently
   * would put one point's command and its retry on different lanes.
   */
  processing: {
    metricShards: Config.value(optionalEnvironmentString, { env: "METRIC_PROCESSING_SHARDS" }),
    logShards: Config.value(optionalEnvironmentString, { env: "LOG_PROCESSING_SHARDS" }),
    /**
     * How many GroupQueue lanes a hot trace's `recordSpan` commands spread
     * across. Read from the variable the App already reads: producer and
     * consumer must clamp the lane count identically or a span is staged onto a
     * group nothing claims.
     */
    traceSpanShards: Config.value(optionalEnvironmentString, {
      env: "TRACE_SPAN_PROCESSING_SHARDS",
    }),
  },
  /**
   * The Eventing fold cache's consistency TTL (ADR-066).
   *
   * Read from the same variable the App reads. The App still produces into the
   * pipelines this process folds, and both graphs cache one Redis keyspace, so
   * two TTLs would expire each other's entries early — and a fold-cache miss is
   * treated as authoritative, which makes an early expiry a stale read rather
   * than an error. An unparseable value is no value: the store's own default
   * already sits at the replication-lag floor, and it clamps anything below it.
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
   * The worker's one HTTP listener, and the bearer gate in front of it.
   *
   * Read at the application's own spellings and defaulted to the same port
   * (2999), because the chart's `startupProbe` and `livenessProbe` already
   * name it: a worker that listened elsewhere would be restarted by the
   * kubelet on every rollout.
   */
  liveness: {
    metricsPort: Config.value(optionalEnvironmentString, { env: "WORKER_METRICS_PORT" }),
    metricsToken: Config.secret({ optional: true, env: "METRICS_API_KEY" }),
  },
  /**
   * The fallback retention for event rows whose tenant declares no override.
   *
   * The same variable the application reads, and the same platform default
   * when it is unset: the two graphs stamp rows in one ClickHouse, so a
   * worker with a different default would expire a tenant's events early.
   */
  retention: {
    defaultDays: Config.value(optionalEnvironmentString, {
      env: "LANGWATCH_DEFAULT_RETENTION_DAYS",
    }),
  },
  infrastructure: {
    /**
     * The one Postgres connection this process opens.
     *
     * Read at the application's own spelling, because the process store, every
     * ledger head and every read-side repository in this process live in the
     * same database the control plane writes.
     */
    database: {
      url: Config.value(optionalEnvironmentString, { env: "DATABASE_URL" }),
    },
    /**
     * The event store's endpoint, plus the per-organization private routes.
     *
     * The routes are read off the raw environment rather than declared as
     * leaves: their names carry the organization id
     * (`CLICKHOUSE_URL__<label>__<organizationId>`), so there is no fixed set
     * to declare and the shared parser is what both processes read them with.
     */
    clickhouse: {
      url: Config.value(optionalEnvironmentString, { env: "CLICKHOUSE_URL" }),
    },
    redis: {
      url: Config.value(optionalEnvironmentString, { env: "REDIS_URL" }),
      clusterEndpoints: Config.value(optionalEnvironmentString, {
        env: "REDIS_CLUSTER_ENDPOINTS",
      }),
      dbIndex: Config.value(optionalEnvironmentString, { env: "REDIS_DB_INDEX" }),
    },
    groupQueue: {
      globalConcurrency: Config.value(optionalEnvironmentString, {
        env: "GLOBAL_QUEUE_CONCURRENCY",
      }),
      zstdWritesEnabled: Config.value(optionalEnvironmentString, {
        env: "GROUP_QUEUE_ZSTD_WRITES_ENABLED",
      }),
      msgpackWritesEnabled: Config.value(optionalEnvironmentString, {
        env: "GROUP_QUEUE_MSGPACK_WRITES_ENABLED",
      }),
      tenantConcurrencyCap: Config.value(optionalEnvironmentString, {
        env: "LANGWATCH_DISPATCH_TENANT_CAP",
      }),
      globalConcurrencyBudget: Config.value(optionalEnvironmentString, {
        env: "LANGWATCH_DISPATCH_GLOBAL_BUDGET",
      }),
    },
    storage: {
      backend: Config.value(z.enum(["s3", "azure"]).optional(), {
        env: "STORED_OBJECTS_BACKEND",
      }),
      localFilesystemRoot: Config.value(optionalEnvironmentString, {
        env: "LANGWATCH_LOCAL_STORAGE_PATH",
      }),
      s3: {
        bucket: Config.value(optionalEnvironmentString, { env: "S3_BUCKET_NAME" }),
        endpoint: Config.value(optionalEnvironmentString, { env: "S3_ENDPOINT" }),
        region: Config.value(optionalEnvironmentString, { env: "S3_REGION" }),
        accessKeyId: Config.value(optionalEnvironmentSecret, { env: "S3_ACCESS_KEY_ID" }),
        secretAccessKey: Config.value(optionalEnvironmentSecret, {
          env: "S3_SECRET_ACCESS_KEY",
        }),
        sessionToken: Config.value(optionalEnvironmentSecret, { env: "S3_SESSION_TOKEN" }),
      },
      /**
       * The operator's assertion that the Azure container reaps orphaned trace
       * spool objects.
       *
       * Read through `environmentOneOrTrueSchema` because that is exactly how
       * the App reads it (`"1"` or a case-insensitive `"true"`, and nothing
       * else). `environmentBooleanSchema` would disagree twice: it refuses
       * `TRUE`, which the App accepts, and it refuses every other spelling
       * outright, so `AZURE_BLOB_SPOOL_RETENTION_CONFIRMED=yes` would stop this
       * process booting where the App reads it as "not confirmed" and carries
       * on. Both disagreements are silent in the direction that matters: a
       * process that reads the assertion differently from its twin either
       * writes spool objects nothing will ever reap, or refuses to write them
       * and quietly ingests every oversized span inline.
       */
      azureSpoolRetentionConfirmed: Config.value(environmentOneOrTrueSchema, {
        env: "AZURE_BLOB_SPOOL_RETENTION_CONFIRMED",
      }),
      /**
       * The Azure Blob account this process reads and writes dataset chunks
       * through, mirroring the `AZURE_BLOB_*` block the App reads for the
       * same purpose (`api.config.ts`). Interpreted nowhere here —
       * `resolveAzureCredentials` is the one place that decides which auth
       * mode applies.
       */
      azure: {
        authMode: Config.value(optionalEnvironmentString, { env: "AZURE_BLOB_AUTH_MODE" }),
        accountName: Config.value(optionalEnvironmentString, {
          env: "AZURE_BLOB_ACCOUNT_NAME",
        }),
        accountKey: Config.value(optionalEnvironmentString, {
          env: "AZURE_BLOB_ACCOUNT_KEY",
        }),
        container: Config.value(optionalEnvironmentString, { env: "AZURE_BLOB_CONTAINER" }),
        endpoint: Config.value(optionalEnvironmentString, { env: "AZURE_BLOB_ENDPOINT" }),
        authorityHost: Config.value(optionalEnvironmentString, {
          env: "AZURE_BLOB_AUTHORITY_HOST",
        }),
        tokenAudience: Config.value(optionalEnvironmentString, {
          env: "AZURE_BLOB_TOKEN_AUDIENCE",
        }),
        allowInsecureTokenEndpointForTests: Config.value(optionalEnvironmentString, {
          env: "AZURE_BLOB_ALLOW_INSECURE_TOKEN_ENDPOINT_FOR_TESTS",
        }),
        identity: {
          tenantId: Config.value(optionalEnvironmentString, { env: "AZURE_TENANT_ID" }),
          clientId: Config.value(optionalEnvironmentString, { env: "AZURE_CLIENT_ID" }),
          federatedTokenFile: Config.value(optionalEnvironmentString, {
            env: "AZURE_FEDERATED_TOKEN_FILE",
          }),
        },
      },
    },
    outboundProxy: {
      https: Config.value(optionalProxyValue, { env: "HTTPS_PROXY" }),
      http: Config.value(optionalProxyValue, { env: "HTTP_PROXY" }),
      noProxy: Config.value(optionalProxyValue, { env: "NO_PROXY" }),
    },
    /**
     * The address policy an outbound model-provider credential probe is judged
     * by.
     *
     * These two are the whole of what the model gateway needs from the
     * environment that this module does not already read. The other three
     * inputs are projections rather than new leaves, and each is a deliberate
     * refusal to declare a twin:
     *
     *   isSaas          `deployment.saas`, already read from `IS_SAAS` through
     *                   the same one-or-true schema the App reads it with. A
     *                   second leaf over one variable is how two answers to
     *                   "is this the hosted install" get into one process, and
     *                   that answer decides whether a SYSTEM provider is
     *                   switched on for every project.
     *   cipher key      `automation.credentialsEncryptionKey`, which already
     *                   resolves `CREDENTIALS_SECRET` then `NEXTAUTH_SECRET`
     *                   in the App's own order. A provider credential is
     *                   written by whichever tier the customer saved it on and
     *                   read back by the other, so a second key here would
     *                   report every configured provider as unusable.
     *   environment     the raw string bag, resolved below. WHICH variable
     *                   carries a provider's key is the provider registry's
     *                   business; whether this deployment set it is the
     *                   environment's.
     *
     * An unset allowlist is an empty one rather than a wildcard: a wildcard
     * read out of an absent variable is how a fence stops fencing without
     * anyone deciding it should. Both are read exactly as `apps/api` reads
     * them, because a probe answered differently by the two tiers is a
     * credential that saves on one screen and fails on the other.
     */
    modelProvider: {
      blockLocalHttpCalls: Config.value(environmentOneOrTrueSchema, {
        env: "BLOCK_LOCAL_HTTP_CALLS",
      }),
      allowedProxyHosts: Config.value(optionalEnvironmentString, {
        env: "ALLOWED_PROXY_HOSTS",
      }),
      // Where the OpenAI-compatible execution proxy answers. The SAME variable
      // `apps/api` resolves its authoring model handles through, because a
      // model call this process makes and a model call that one makes must
      // reach one engine — two addresses would bill two different proxies for
      // one project's key. Optional: a deployment that named no engine
      // composes no execution handle and every model CALL this process would
      // make is absent by name, while every provider READ still answers.
      nlpServiceUrl: Config.value(optionalEnvironmentString, {
        env: "LANGWATCH_NLP_SERVICE",
      }),
    },
  },
});

type WorkerConfigProjection = ConfigValue<typeof workerConfigDefinition>;

export type WorkerOutboundProxyConfig = Readonly<{
  https?: string;
  http?: string;
  noProxy?: string;
}>;

/**
 * One organization's own S3, for a deployment that routes some tenants to
 * their own bucket rather than the shared one (BYOC).
 *
 * Every field is required together, because a half-configured route is worse
 * than none: a bucket without credentials would fall back to the shared
 * identity and write one tenant's objects into another tenant's account.
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
   * Organization id to that organization's own S3, keyed exactly as the
   * application keys it.
   *
   * Read here rather than declared as one variable per tenant because the
   * names carry the data: `DATAPLANE_S3__<label>__<organizationId>`. A process
   * that did not read them would resolve every project to the shared bucket
   * and write a BYOC customer's objects into the wrong account — silently, and
   * for as long as it ran.
   */
  dataplaneS3: ReadonlyMap<string, WorkerDataplaneS3Config>;
}>;

export type WorkerInfrastructureConfig = Readonly<{
  database: WorkerDatabaseConfig;
  clickhouse: WorkerClickHouseConfig;
  redis: RedisConfigResolution;
  groupQueue: GroupQueuePolicy;
  storage: WorkerStorageConfig;
  outboundProxy: WorkerOutboundProxyConfig;
  modelProvider: WorkerModelProviderConfig;
}>;

/**
 * What the model gateway was told about this deployment.
 *
 * `isSaas` is deliberately NOT here: it is `deployment.saas`, and the gateway
 * composition reads it from there so one variable keeps one meaning across
 * this process. What is here is the fence a credential probe is judged by,
 * plus the environment bag a SYSTEM provider's credential and a managed
 * organization's Bedrock configuration are read out of.
 */
export type WorkerModelProviderConfig = Readonly<{
  blockLocalHttpCalls: boolean;
  allowedProxyHosts: readonly string[];
  /**
   * The NLP engine's address, or nothing where the deployment named none.
   *
   * The address rather than the proxy PATH: the path belongs to the workflow
   * feature and the composition root joins the two, which is what keeps this
   * module the process's only environment reader without it also owning a
   * route another package defines.
   */
  nlpServiceUrl: string | undefined;
  /**
   * The process environment the provider registry resolves a system
   * credential from.
   *
   * A map rather than named leaves, and it is the one place in this config
   * where that is right: sixteen providers each with their own `apiKey` and
   * optional `endpointKey`, plus custom providers naming keys no schema here
   * could enumerate. Reading it here rather than at the gateway is what keeps
   * this module the process's only environment reader.
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
 * Everything one process needs to send mail, or nothing at all.
 *
 * `baseHost` rides alongside the gateway configuration rather than inside it
 * because the two answer different questions: the gateway decides how a message
 * leaves, the host decides what the message can link to. A notifier needs both,
 * and neither is derivable from the other.
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
   * The three daily persist ceilings, by plan tier.
   *
   * All three are carried even though this process settles on the paid one:
   * the tier is chosen by an entitlement provider it does not compose, and
   * carrying only the number in use would hide from a reader that the choice
   * exists at all.
   */
  persistDailyCapFree: number;
  persistDailyCapPaid: number;
  persistDailyCapEnterprise: number;
}>;

/**
 * The Google DLP service-account document, narrowed to the one field the
 * client cannot be built without.
 *
 * `passthrough` on purpose: the whole document is handed to the SDK, and
 * dropping the private key while keeping the project id would produce a client
 * that constructs and then fails to authenticate.
 */
const googleDlpCredentialsSchema = z.object({ project_id: z.string().trim().min(1) }).passthrough();

export type GoogleDlpCredentials = z.infer<typeof googleDlpCredentialsSchema>;

export type GoogleDlpCredentialsFailure =
  | Readonly<{ reason: "invalid-json"; error: unknown }>
  | Readonly<{ reason: "missing-project-id"; error: z.ZodError }>;

/**
 * The privacy knobs this process ingests under, projected the way
 * `platform/app/src/runtime/trace-privacy.config.ts` projects the same four
 * variables. `presidio.timeoutMs` is the application's own constant rather
 * than a fifth variable: neither graph reads it from the environment, and a
 * second spelling would be a knob nobody sets and nobody notices.
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
 * The application's default and its parse, both.
 *
 * `Number.parseInt` on a non-numeric string yields NaN and on `"10s"` yields
 * 10; anything not finite or not positive falls back. Copied rather than
 * tightened: a process that refused a value its twin accepts would not boot,
 * and one that accepted a value its twin rejects would wait a different time
 * for the same download.
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
 * The PostHog project the ingest path's one product event is captured into.
 *
 * Both absent is a supported deployment and not a degraded one: it is the
 * application's own behaviour when `POSTHOG_KEY` is unset, and it means this
 * install chose not to run product analytics.
 */
export type WorkerProductAnalyticsConfig = Readonly<{
  key?: string;
  host?: string;
}>;

/**
 * The webhook endpoint policy's two unsafe opt-ins, as booleans.
 *
 * `"1"` and nothing else, which is the App's own reading: it compares the raw
 * variable to the string `"1"`, so `true`, `yes` and `TRUE` all mean off on
 * both sides.
 */
export type WorkerWebhookConfig = Readonly<{
  allowInsecureLocalUrls: boolean;
  allowAmbientAwsCredentials: boolean;
}>;

/**
 * Where the Langy conversation pipeline dispatches a turn.
 *
 * Absent exactly when this deployment named neither variable. The pipeline
 * still mounts without it — a turn dispatched into no manager is answered
 * `unavailable`, which the process manager already treats as a failed turn
 * rather than a lost one.
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
 * The AuthZ decisions this process was configured with, already interpreted.
 *
 * The same two fields `apps/api` projects, resolved from the same variables by
 * the same rule: one deployment, one answer to whether the epoch cache is on
 * and which project is the demo.
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
   * Where this process pushes its own metrics, if it was told to push any.
   *
   * This process serves an empty Prometheus exposition on purpose — every
   * series it records goes out over OTLP — so until something starts this
   * export the worker's instruments write into a no-op meter and its metrics
   * exist nowhere at all.
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
   * Where the evaluator service answers, for the callers that are not privacy.
   *
   * The SAME `LANGEVALS_ENDPOINT` the privacy projection reads, projected a
   * second time rather than read a second time: one variable names one
   * service, and two leaves over it could be answered differently by a future
   * default. Topic clustering posts its pages here.
   */
  langevals: Readonly<{ endpoint: string | undefined }>;
  tokenizer: WorkerTraceTokenizerConfig;
  stripe: WorkerStripeConfig;
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
   * The flag overrides this deployment set in its environment.
   *
   * Resolved from the raw source rather than from the projection above,
   * because the names are the flags' own — one variable per flag plus the
   * `FEATURE_FLAG_FORCE_ENABLE` list — and the feature owns that vocabulary.
   * Absent variables give an empty override map, which is a deployment that
   * runs every flag on its stored rules. No new configuration leaf: these are
   * the same variables the application already reads.
   */
  featureFlags: FeatureFlagConfig;
}>;

export function resolveWorkerConfig(source: Readonly<Record<string, unknown>>): WorkerConfig {
  const value = RuntimeConfig.create({
    name: "worker",
    definition: workerConfigDefinition,
    source: normalizeWorkerConfigSource(source),
  }).value;
  refuseWorkerSelfIngest(value, source);
  const mail = resolveWorkerMailConfig(value.mail, value.nextauthSecret);
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
    deployment: {
      ...value.deployment,
      // Blank is not a key: an operator who exported the variable empty has
      // rotated nothing, and an empty string reaching the verifier refuses
      // every licence the deployment holds.
      licensePublicKey: value.deployment.licensePublicKey?.trim() || undefined,
    },
    ...(mail ? { mail } : {}),
    automation: resolveWorkerAutomationConfig(value.automation, value.nextauthSecret),
    authz: {
      // The platform app's exact rule, so one variable means one thing across
      // every tier that reads it.
      epochCacheEnabled: value.authz.epochCache === "1" || value.authz.epochCache === "true",
      demoProjectId: value.authz.demoProjectId?.trim() || undefined,
    },
    tracePrivacy: resolveWorkerTracePrivacyConfig({
      tracePrivacy: value.tracePrivacy,
      nodeEnvironment: value.nodeEnvironment,
    }),
    langevals: { endpoint: value.tracePrivacy.langevalsEndpoint },
    tokenizer: resolveWorkerTraceTokenizerConfig(value.tokenizer),
    stripe: value.stripe,
    productAnalytics: value.productAnalytics,
    gateway: value.gateway,
    webhooks: {
      allowInsecureLocalUrls: value.webhooks.allowInsecureLocalUrls === "1",
      allowAmbientAwsCredentials: value.webhooks.allowAmbientAwsCredentials === "1",
    },
    ...(langy ? { langy } : {}),
    github: value.github,
    processing: value.processing,
    liveness: {
      metricsPort: resolveWorkerMetricsPort(value.liveness.metricsPort),
      metricsToken: value.liveness.metricsToken,
    },
    retention: { defaultDays: resolveWorkerRetentionDays(value.retention.defaultDays) },
    eventing: value.eventing,
    infrastructure: {
      database: { url: value.infrastructure.database.url },
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
 * Refuses a boot whose telemetry exporter points back at this deployment.
 *
 * The platform process this one replaced refused `LANGWATCH_API_KEY` outright,
 * because with a key set the SDK ships the process's own operational telemetry
 * into whatever ingest it is pointed at, and that ingest was always this one:
 * a feedback loop in which every ingested span does work that emits more
 * spans. This process accepts the key on purpose — exporting to a DIFFERENT
 * LangWatch install is a supported shape — so the refusal narrowed to the one
 * case the blanket rule was protecting.
 *
 * A worker serves no listener, so the deployment's addresses are the two
 * origins it links back to. `NEXTAUTH_URL` is taken from the source rather
 * than from a projection leaf because this process consumes no such value —
 * it needs only to recognise its own front door — and a leaf nothing reads
 * would be a configuration field with no consumer.
 */
function refuseWorkerSelfIngest(
  value: WorkerConfigProjection,
  source: Readonly<Record<string, unknown>>,
): void {
  const nextauthUrl = source.NEXTAUTH_URL;
  assertObservabilityDoesNotSelfIngest({
    runtime: "worker",
    apiKeyEnv: "LANGWATCH_API_KEY",
    apiKey: value.observability.apiKey,
    endpointEnv: "LANGWATCH_ENDPOINT",
    endpoint: value.observability.endpoint,
    deployment: [
      { env: "BASE_HOST", value: value.mail.baseHost },
      { env: "NEXTAUTH_URL", value: typeof nextauthUrl === "string" ? nextauthUrl : undefined },
    ],
  });
}

/**
 * The Langy agent manager's address and secret, or nothing.
 *
 * The pair is refused TOGETHER, at the App's own spelling of the refusal:
 * either both are configured or neither is. Half a pair is not a smaller
 * deployment — a URL without a secret would dispatch every turn without
 * authentication, and the manager would reject it turn by turn rather than at
 * boot.
 */
function resolveWorkerLangyConfig(
  langy: WorkerConfigProjection["langy"],
): WorkerLangyConfig | undefined {
  const agentUrl = langy.agentUrl?.trim();
  const internalSecret = langy.internalSecret?.trim();
  if (!agentUrl && !internalSecret) return undefined;
  if (!agentUrl || !internalSecret) {
    throw new Error("OPENCODE_AGENT_URL and LANGY_INTERNAL_SECRET must be configured together");
  }

  return { agentUrl, internalSecret };
}

/**
 * The mail configuration, or nothing.
 *
 * Nothing exactly when `BASE_HOST` is absent or blank. It is the one variable
 * the whole capability rests on — the sender address is derived from it and
 * every mail links back through it — so a half-filled value would produce mail
 * addressed from a host that is not the deployment's and pointing at links
 * that are not either. What an absent capability costs is a decision for the
 * graph that would have consumed it, not for this projection.
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
 * The automation knobs, with the credentials key resolved the way the
 * application resolves it.
 *
 * `CREDENTIALS_SECRET` first and `NEXTAUTH_SECRET` second, because that is the
 * order `platform/app/src/utils/encryption.ts` reads them in and the rows were
 * written by whichever it found. Falling back to neither is a valid
 * deployment: an install that never stored a Slack bot token or a webhook
 * secret has nothing to decrypt.
 */
function resolveWorkerAutomationConfig(
  automation: WorkerConfigProjection["automation"],
  nextauthSecret: string | undefined,
): WorkerAutomationConfig {
  const credentialsEncryptionKey =
    automation.credentialsEncryptionKey?.trim() || nextauthSecret?.trim();

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
 * The privacy knobs, projected once at boot.
 *
 * Invalid service-account JSON deliberately preserves the application's
 * old unavailable-DLP behaviour rather than making an unrelated boot fail:
 * DLP is a FALLBACK for a Presidio outage, and refusing to start a worker
 * because the fallback's credentials are malformed would turn a degraded
 * path into no ingestion at all. The failure is reported to the caller so a
 * boot can log it.
 */
export function resolveWorkerTracePrivacyConfig(
  input: {
    tracePrivacy: WorkerConfigProjection["tracePrivacy"];
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
      endpoint: input.tracePrivacy.langevalsEndpoint,
      timeoutMs: DEFAULT_PRESIDIO_TIMEOUT_MS,
    },
    isProduction: input.nodeEnvironment === "production",
    nativePolicyEnforced: input.tracePrivacy.dataPrivacyEnforcement !== "off",
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
 * The per-organization S3 routes this deployment declares.
 *
 * Parsed by the shared helper rather than by a second reader here: the
 * variable NAMES carry the organization id and the declarative projection can
 * only name variables it knows in advance, so a worker that split
 * `<label>__<organizationId>` differently from the API would write a
 * customer's objects where that customer cannot read them.
 *
 * A malformed entry is skipped; a duplicate organization id is raised by the
 * helper, because two routes for one tenant is a question this process cannot
 * answer. The skipped list is dropped rather than logged because this
 * projection is pure — it runs before the process has a logger, and the API
 * reads the same variables and names them.
 */
export function resolveWorkerDataplaneS3Config(
  source: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, WorkerDataplaneS3Config> {
  return parseDataplaneS3RoutingTable(source).routes;
}

/**
 * The per-organization ClickHouse endpoints this deployment declared.
 *
 * Parsed by the shared helper rather than by a second reader here: the
 * variable names carry the organization id, and a worker that split them
 * differently from the application would route one organization's folds to
 * another organization's cluster.
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
/**
 * The deployment's answers for the model gateway.
 *
 * The allowlist is split on commas and trimmed, and blank entries are dropped:
 * an empty host matches nothing useful and would otherwise sit in the list
 * looking like a rule. The flag arrived already read as `1`-or-`true`, which
 * is the App's own spelling and `apps/api`'s, so the three tiers cannot
 * disagree about whether the fence is up.
 */
function resolveWorkerModelProviderConfig(
  value: Readonly<{
    blockLocalHttpCalls: boolean;
    allowedProxyHosts: string | undefined;
    nlpServiceUrl: string | undefined;
  }>,
  environment: Readonly<Record<string, string | undefined>>,
): WorkerModelProviderConfig {
  const nlpServiceUrl = value.nlpServiceUrl?.trim();
  return {
    blockLocalHttpCalls: value.blockLocalHttpCalls,
    allowedProxyHosts:
      value.allowedProxyHosts
        ?.split(",")
        .map((host) => host.trim())
        .filter((host) => host.length > 0) ?? [],
    // A blank variable is an unset one. An empty base URL would compose a
    // proxy address of `/go/proxy/v1`, which resolves against nothing and
    // fails on the first model call rather than at boot.
    nlpServiceUrl: nlpServiceUrl ? nlpServiceUrl : undefined,
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

/**
 * The platform default, unless this deployment named another.
 *
 * Unparseable is the default rather than a refusal, which is the reading the
 * application takes: a retention override is an operator convenience, and a
 * typo in it must not stop the fleet folding.
 */
function resolveWorkerRetentionDays(value: string | undefined): number {
  if (value === undefined || value === "") return PLATFORM_DEFAULT_RETENTION_DAYS;
  const days = Number.parseInt(value, 10);
  return Number.isFinite(days) && days > 0 ? days : PLATFORM_DEFAULT_RETENTION_DAYS;
}
