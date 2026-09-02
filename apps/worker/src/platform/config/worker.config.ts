import {
  Config,
  environmentBooleanSchema,
  environmentOneOrTrueSchema,
  RuntimeConfig,
  type ConfigValue,
} from "@langwatch/config";
import { resolveGroupQueuePolicyFromEnv, type GroupQueuePolicy } from "@langwatch/group-queue";
import { EmailProviderService, type MailerConfiguration } from "@langwatch/notification-server";
import { RedisConfigService, type RedisConfigResolution } from "@langwatch/redis-client";
import { z } from "zod";

const DEFAULT_LOCAL_STORAGE_ROOT = "/var/lib/langwatch/objects";
const DEFAULT_PRODUCTION_QUEUE_DRAIN_MS = 25_000;
const DEFAULT_DEVELOPMENT_QUEUE_DRAIN_MS = 5_000;
const APP_CLOSE_SLACK_MS = 5_000;
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
  automation: {
    emailHourlyCap: Config.value(z.coerce.number().int().positive().default(100), {
      env: "TRIGGER_EMAIL_HOURLY_CAP",
    }),
    tenantDailyCap: Config.value(z.coerce.number().int().positive().default(10000), {
      env: "TRIGGER_EMAIL_TENANT_DAILY_CAP",
    }),
    credentialsEncryptionKey: Config.secret({ optional: true, env: "CREDENTIALS_SECRET" }),
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
  infrastructure: {
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
    },
    outboundProxy: {
      https: Config.value(optionalProxyValue, { env: "HTTPS_PROXY" }),
      http: Config.value(optionalProxyValue, { env: "HTTP_PROXY" }),
      noProxy: Config.value(optionalProxyValue, { env: "NO_PROXY" }),
    },
  },
});

type WorkerConfigProjection = ConfigValue<typeof workerConfigDefinition>;

export type WorkerOutboundProxyConfig = Readonly<{
  https?: string;
  http?: string;
  noProxy?: string;
}>;

export type WorkerStorageConfig = Readonly<{
  backend: "azure" | "s3";
  localFilesystemRoot: string;
  s3: Readonly<{
    bucket?: string;
    endpoint?: string;
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
  }>;
}>;

export type WorkerInfrastructureConfig = Readonly<{
  redis: RedisConfigResolution;
  groupQueue: GroupQueuePolicy;
  storage: WorkerStorageConfig;
  outboundProxy: WorkerOutboundProxyConfig;
}>;

export type WorkerShutdownConfig = Readonly<{
  processDeadlineMs: number;
}>;

/** The command-lane counts the metric and log processing pipelines shard on. */
export type WorkerProcessingConfig = Readonly<{
  metricShards?: string;
  logShards?: string;
}>;

/** The Eventing substrate's own knobs, as this process resolved them. */
export type WorkerEventingConfig = Readonly<{
  foldCacheTtlSeconds?: number;
}>;

/** Which product this deployment is, resolved from the one shared variable. */
export type WorkerDeploymentConfig = Readonly<{
  saas: boolean;
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

/** The graph-alert half of Automation's own knobs, as this process read them. */
export type WorkerAutomationConfig = Readonly<{
  emailHourlyCap: number;
  tenantDailyCap: number;
  /** Absent on a deployment that stored no encrypted automation credentials. */
  credentialsEncryptionKey?: string;
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

export type WorkerConfig = Readonly<{
  processRole: "worker";
  environment: string;
  nodeEnvironment: "development" | "test" | "production";
  serviceName: string;
  serviceVersion?: string;
  logger: WorkerConfigProjection["logger"];
  observability: WorkerConfigProjection["observability"];
  shutdown: WorkerShutdownConfig;
  deployment: WorkerDeploymentConfig;
  /** Absent when the deployment named no `BASE_HOST`; see `resolveWorkerMailConfig`. */
  mail?: WorkerMailConfig;
  automation: WorkerAutomationConfig;
  stripe: WorkerStripeConfig;
  gateway: WorkerGatewayConfig;
  github: WorkerGithubConfig;
  processing: WorkerProcessingConfig;
  eventing: WorkerEventingConfig;
  infrastructure: WorkerInfrastructureConfig;
}>;

export function resolveWorkerConfig(source: Readonly<Record<string, unknown>>): WorkerConfig {
  const value = RuntimeConfig.create({
    name: "worker",
    definition: workerConfigDefinition,
    source: normalizeWorkerConfigSource(source),
  }).value;
  const mail = resolveWorkerMailConfig(value.mail, value.nextauthSecret);

  return {
    processRole: value.processRole,
    environment: value.environment,
    nodeEnvironment: value.nodeEnvironment,
    serviceName: value.serviceName,
    serviceVersion: value.serviceVersion,
    logger: value.logger,
    observability: value.observability,
    shutdown: resolveWorkerShutdownConfig({
      nodeEnvironment: value.nodeEnvironment,
      environment: value.environment,
      queueDrainTimeoutMs: value.shutdown.queueDrainTimeoutMs,
    }),
    deployment: value.deployment,
    ...(mail ? { mail } : {}),
    automation: resolveWorkerAutomationConfig(value.automation, value.nextauthSecret),
    stripe: value.stripe,
    gateway: value.gateway,
    github: value.github,
    processing: value.processing,
    eventing: value.eventing,
    infrastructure: {
      redis: new RedisConfigService().resolve(value.infrastructure.redis),
      groupQueue: resolveGroupQueuePolicyFromEnv(value.infrastructure.groupQueue),
      storage: {
        backend: value.infrastructure.storage.backend ?? "s3",
        localFilesystemRoot:
          value.infrastructure.storage.localFilesystemRoot ?? DEFAULT_LOCAL_STORAGE_ROOT,
        s3: {
          ...value.infrastructure.storage.s3,
          region: resolveS3Region(value.infrastructure.storage.s3),
        },
      },
      outboundProxy: value.infrastructure.outboundProxy,
    },
  };
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
