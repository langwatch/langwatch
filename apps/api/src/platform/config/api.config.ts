import {
  assertGatewaySecretsAllOrNone,
  assertObservabilityDoesNotSelfIngest,
  authzConfigDefinition,
  clickhouseConfigDefinition,
  Config,
  egressConfigDefinition,
  environmentBooleanSchema,
  environmentOneOrTrueSchema,
  githubAppConfigDefinition,
  groupQueueConfigDefinition,
  licensingConfigDefinition,
  loggerConfigDefinition,
  mailConfigDefinition,
  objectStorageConfigDefinition,
  observabilityConfigDefinition,
  parseDataplaneS3RoutingTable,
  postgresConfigDefinition,
  redisConfigDefinition,
  resolveTelemetryConfiguration,
  runtimeIdentityConfigDefinition,
  RuntimeConfig,
  portSchema,
  type ConfigValue,
} from "@langwatch/config";
import {
  createLogger,
  loggerConfigurationFrom,
  type Logger,
  type LoggerConfiguration,
} from "@langwatch/observability";
import {
  parseRoutingTable,
  poolSizingFromEnv,
  type PoolSizingInput,
} from "@langwatch/clickhouse-client";
import {
  otlpMetricsExportOptionsFrom,
  type OtlpMetricsExportOptions,
  type ProcessObservabilityOptions,
} from "@langwatch/observability/node";
import { resolveGroupQueuePolicyFromEnv, type GroupQueuePolicy } from "@langwatch/group-queue";
import { EmailProviderService, type MailerConfiguration } from "@langwatch/notification-server";
import { resolveFeatureFlagConfig, type FeatureFlagConfig } from "@langwatch/feature-flag-contract";
import { resolvePlatformDefaultRetentionDays } from "@langwatch/data-retention-server";
import { getLatestOpenAIChatFlagship } from "@langwatch/model-provider-contract";
import { RedisConfigService, type RedisConfigResolution } from "@langwatch/redis-client";
import type {
  AzureBlobCredentialsConfig,
  AzureInjectedIdentity,
} from "@langwatch/stored-object-server";
import { buildStudioLambdaConfig, type StudioLambdaConfig } from "@langwatch/workflow-server";
import { z } from "zod";

const optionalEnvironmentString = z.string().optional();

/**
 * Built on demand rather than at module load: this module runs before the
 * process has configured its logging, so a logger held in a constant would be
 * the one that was created first rather than the one the deployment asked for.
 */
const configLogger = (): Pick<Logger, "warn"> => createLogger("langwatch:api:config");

/**
 * Telemetry flush and infrastructure release still have to finish after the
 * listener's own drain grace elapses, so the process deadline sits above it.
 */
const PROCESS_CLOSE_SLACK_MS = 15_000;

/**
 * The scenario fallback model, derived from the registry rather than a
 * literal that would drift as it advances.
 */
const REGISTRY_FLAGSHIP_MODEL = getLatestOpenAIChatFlagship() ?? "openai/gpt-5";

/**
 * A standalone API bootstrap accepts these deterministic aliases. Existing
 * split-process deployment uses LANGWATCH_API_PORT; API_PORT and PORT are new
 * compatibility inputs for a future physical API executable.
 */
export const API_PORT_ENV_PRECEDENCE = ["API_PORT", "LANGWATCH_API_PORT", "PORT"] as const;

/**
 * Same precedence the platform app reads: rows encrypted by one process
 * must be readable by the other.
 */
export const STORED_SECRET_ENCRYPTION_KEY_ENV_PRECEDENCE = [
  "CREDENTIALS_SECRET",
  "NEXTAUTH_SECRET",
] as const;

/**
 * Same two variables as the cipher key: a key hashed by one process must
 * authenticate at the other.
 */
export const API_KEY_PEPPER_ENV_PRECEDENCE = ["CREDENTIALS_SECRET", "NEXTAUTH_SECRET"] as const;

export const apiConfigDefinition = RuntimeConfig.define({
  /** A standalone API owns dispatch-only web behaviour. */
  processRole: Config.value(z.literal("web").default("web"), { env: "API_PROCESS_ROLE" }),
  ...runtimeIdentityConfigDefinition,
  serviceName: Config.value(z.string().min(1).default("langwatch-api"), {
    env: "API_SERVICE_NAME",
  }),
  host: Config.value(z.string().min(1).default("0.0.0.0"), { env: "API_HOST" }),
  port: Config.value(portSchema.default(5560), { env: "API_PORT" }),
  httpDrainGraceMs: Config.value(z.coerce.number().int().min(0).default(5_000), {
    env: "API_HTTP_DRAIN_GRACE_MS",
  }),
  /**
   * Whether every tRPC answer is checked against its declared output schema.
   * Read here and nowhere else. Unset follows `NODE_ENV` — on outside
   * production, where a declared shape documents rather than gates.
   */
  validateTrpcOutput: Config.value(environmentBooleanSchema.optional(), {
    env: "API_TRPC_VALIDATE_OUTPUT",
  }),
  shutdown: {
    deadlineMs: Config.value(z.coerce.number().int().positive().optional(), {
      env: "API_SHUTDOWN_DEADLINE_MS",
    }),
  },
  logger: { ...loggerConfigDefinition },
  observability: { ...observabilityConfigDefinition },
  /**
   * The provisioning family's admin credential. Blank means unconfigured,
   * never a boot refusal.
   */
  instanceAdminApiKey: Config.value(optionalEnvironmentString, {
    env: "LANGWATCH_INSTANCE_ADMIN_API_KEY",
  }),
  /**
   * The internal cron family's shared bearer. Blank means unconfigured — the
   * destructive door stays off — never a boot refusal.
   */
  cronApiKey: Config.value(optionalEnvironmentString, {
    env: "CRON_API_KEY",
  }),
  /**
   * Resolved from {@link STORED_SECRET_ENCRYPTION_KEY_ENV_PRECEDENCE}.
   * Blank-vs-wrong-shape is the cipher's own rule to enforce.
   */
  storedSecretEncryptionKey: Config.value(optionalEnvironmentString, {
    env: "CREDENTIALS_SECRET",
  }),
  /**
   * A separate leaf from the cipher key above: this is the HMAC key
   * VERBATIM, never the decoded bytes, so the two rotate independently.
   */
  apiKeyPepper: Config.value(optionalEnvironmentString, {
    env: "API_KEY_PEPPER",
  }),
  /**
   * Separate from the API-key pepper — virtual keys rotate independently.
   * Blank is fine: `VirtualKeyCryptoAdapter` fails at first hash, not boot.
   */
  virtualKeyPepper: Config.value(optionalEnvironmentString, {
    env: "LW_VIRTUAL_KEY_PEPPER",
  }),
  /**
   * Verified by `/api/internal/gateway` before any handler runs. Blank
   * answers 500 `gateway_internal_secret_missing` rather than falling open.
   */
  gatewayInternalSecret: Config.value(optionalEnvironmentString, {
    env: "LW_GATEWAY_INTERNAL_SECRET",
  }),
  /**
   * Signs short-lived JWTs handed to the data plane — separate from the
   * HMAC secret above (that's IN, this is OUT), rotated independently.
   */
  gatewayJwtSecret: Config.value(optionalEnvironmentString, {
    env: "LW_GATEWAY_JWT_SECRET",
  }),
  /**
   * How long after a request an outcome may still arrive, in milliseconds.
   * Parsed by the gateway package's `settlementGraceMs`, which this raw value
   * feeds, so the REST policy and the settlement sweeper never disagree.
   */
  spendSettlementGraceMs: Config.value(optionalEnvironmentString, {
    env: "LW_SPEND_SETTLEMENT_GRACE_MS",
  }),
  /**
   * The metrics-scrape bearer, under the name every LangWatch tier reads it
   * by. Blank means unconfigured, which in production means no metrics
   * endpoint served.
   */
  metricsApiKey: Config.value(optionalEnvironmentString, {
    env: "METRICS_API_KEY",
  }),
  /**
   * The Langy agent's callback bearer. Blank answers 503 `Not configured`
   * rather than falling open — a deployment with no Langy agent needs none.
   */
  langyInternalSecret: Config.value(optionalEnvironmentString, {
    env: "LANGY_INTERNAL_SECRET",
  }),
  /**
   * `auth0WebhookSecret` blank answers 404, not 401 — an unconfigured
   * install looks unrouted. `provenOffboarding` (`SCIM_V2_GRANTS`) is a
   * CONSTRUCTION input, not a per-tenant flag: one offboarding path per process.
   */
  scim: {
    auth0WebhookSecret: Config.value(optionalEnvironmentString, {
      env: "AUTH0_SCIM_WEBHOOK_SECRET",
    }),
    provenOffboarding: Config.value(environmentBooleanSchema.default(false), {
      env: "SCIM_V2_GRANTS",
    }),
  },
  /**
   * The ClickHouse EXPLAIN endpoint's operator secret. Blank means the
   * endpoint is not registered — no way to reach a cross-tenant EXPLAIN by
   * presenting nothing.
   */
  opsApiKey: Config.value(optionalEnvironmentString, {
    env: "LANGWATCH_OPS_API_KEY",
  }),
  /**
   * `AUTHZ_EPOCH_CACHE` reads "1 or true, else off" like the platform app.
   * `DEMO_PROJECT_ID` blank means no demo project, never `""`.
   */
  authz: {
    ...authzConfigDefinition,
    /**
     * The demo project's attributed account — a separate fact from the
     * project id, since the project is readable by everybody. Both blank on
     * a deployment with no demo project.
     */
    demoProjectUserId: Config.value(optionalEnvironmentString, { env: "DEMO_PROJECT_USER_ID" }),
  },
  /**
   * `secret` is `NEXTAUTH_SECRET` verbatim, never derived from the cipher
   * key. `url` is not re-bound from `publicBaseUrl`.
   */
  browserSession: {
    secret: Config.value(optionalEnvironmentString, { env: "NEXTAUTH_SECRET" }),
    url: Config.value(optionalEnvironmentString, { env: "NEXTAUTH_URL" }),
    mfaEnrollmentOpen: Config.value(optionalEnvironmentString, {
      env: "MFA_ENROLLMENT_OPEN",
    }),
    passkeysEnabled: Config.value(optionalEnvironmentString, { env: "PASSKEYS_ENABLED" }),
    passkeyHandleSecret: Config.value(optionalEnvironmentString, {
      env: "PASSKEY_HANDLE_SECRET",
    }),
  },
  /**
   * Facts about the install itself, read at the App's own spellings so this
   * process and the background one cannot disagree about them.
   */
  deployment: {
    /**
     * `ADMIN_EMAILS`; unset means nobody is a platform operator. The back
     * office matches a signed-in person against this list, and a process that
     * never read it hides `/api/admin/*` from everyone.
     */
    adminEmails: Config.value(optionalEnvironmentString, { env: "ADMIN_EMAILS" }),
  },
  /**
   * Same env vars as the worker's mail config, so sender domains agree on
   * SPF. `BASE_HOST` is read from `publicBaseUrl`, not re-bound here.
   */
  mail: { ...mailConfigDefinition },
  /**
   * The payment provider, under the names every LangWatch tier already reads
   * them by. Every leaf is optional: a self-hosted or OSS install bills through
   * nobody, and `resolveApiBillingConfig` answers nothing rather than letting a
   * half-configured Stripe boot a webhook that cannot verify a signature.
   */
  billing: {
    stripeSecretKey: Config.value(optionalEnvironmentString, { env: "STRIPE_SECRET_KEY" }),
    stripeWebhookSecret: Config.value(optionalEnvironmentString, {
      env: "STRIPE_WEBHOOK_SECRET",
    }),
    licensePaymentLinkId: Config.value(optionalEnvironmentString, {
      env: "STRIPE_LICENSE_PAYMENT_LINK_ID",
    }),
    licensePrivateKey: Config.value(optionalEnvironmentString, {
      env: "LANGWATCH_LICENSE_PRIVATE_KEY",
    }),
    slackSubscriptionsChannel: Config.value(optionalEnvironmentString, {
      env: "SLACK_CHANNEL_SUBSCRIPTIONS",
    }),
  },
  infrastructure: {
    /**
     * Optional, like Redis: no database composes none, never an
     * unconfigured client from a blank connection string.
     */
    database: { ...postgresConfigDefinition },
    /**
     * TWO separate identities: `url` is full-access; `langwatchQl` is the
     * RESTRICTED user a member's SQL runs as. Neither defaults to the other.
     */
    clickhouse: {
      ...clickhouseConfigDefinition,
      /**
       * A THIRD identity for the cross-tenant EXPLAIN endpoint. Never falls
       * back to the tenant-keyed client; unset means unserved.
       */
      opsUrl: Config.value(optionalEnvironmentString, { env: "CLICKHOUSE_OPS_URL" }),
      langwatchQl: {
        url: Config.value(optionalEnvironmentString, { env: "LWQL_CLICKHOUSE_URL" }),
        username: Config.value(optionalEnvironmentString, { env: "LWQL_CLICKHOUSE_USER" }),
        password: Config.value(optionalEnvironmentString, { env: "LWQL_CLICKHOUSE_PASSWORD" }),
        database: Config.value(optionalEnvironmentString, { env: "LWQL_DATABASE" }),
        tenantSetting: Config.value(optionalEnvironmentString, { env: "LWQL_TENANT_SETTING" }),
      },
    },
    /**
     * Absent execution addresses refuse at the call, not at boot — a
     * supported read-only shape. `publicBaseUrl` is the public origin, not
     * this listener's bind address (they differ behind a proxy).
     */
    execution: {
      nlpServiceUrl: Config.value(optionalEnvironmentString, {
        env: "LANGWATCH_NLP_SERVICE",
      }),
      langevalsEndpoint: Config.value(optionalEnvironmentString, {
        env: "LANGEVALS_ENDPOINT",
      }),
      publicBaseUrl: Config.value(optionalEnvironmentString, { env: "BASE_HOST" }),
      defaultModel: Config.value(optionalEnvironmentString, {
        env: "LANGWATCH_DEFAULT_MODEL",
      }),
    },
    /**
     * `isSaas` gates SYSTEM providers explicitly, never inferred from an
     * `OPENAI_API_KEY` a self-hosted install happens to export.
     */
    modelProvider: {
      isSaas: Config.value(optionalEnvironmentString, { env: "IS_SAAS" }),
      ...egressConfigDefinition,
    },
    /**
     * All five optional and read together: none set reads as "not connected"
     * via the feature's `configured` flag, not a call failure. `host` is
     * empty for github.com, the Enterprise Server host otherwise.
     */
    github: {
      ...githubAppConfigDefinition,
      privateKey: Config.value(optionalEnvironmentString, { env: "GITHUB_LANGY_PRIVATE_KEY" }),
      appSlug: Config.value(optionalEnvironmentString, { env: "GITHUB_LANGY_APP_SLUG" }),
      webhookSecret: Config.value(optionalEnvironmentString, {
        env: "GITHUB_LANGY_WEBHOOK_SECRET",
      }),
    },
    /**
     * Optional; absent is normal since the licensing contract embeds the
     * production public key. Exists for ROTATION. The worker reads the SAME
     * variable (ADR-027) so both processes agree on whether it's licensed.
     */
    licensing: { ...licensingConfigDefinition },
    /**
     * BACKEND is a selection, not a fallback chain: naming `azure` never
     * silently resolves to a configured S3 bucket instead.
     */
    storedObjects: {
      ...objectStorageConfigDefinition,
      /**
       * The operator's assertion that the Azure container reaps an orphaned
       * trace spool object. Read exactly the way the worker reads it, since
       * disagreement either orphans spool objects or ingests spans inline.
       */
      azureSpoolRetentionConfirmed: Config.value(environmentOneOrTrueSchema, {
        env: "AZURE_BLOB_SPOOL_RETENTION_CONFIRMED",
      }),
    },
    redis: { ...redisConfigDefinition },
    groupQueue: { ...groupQueueConfigDefinition },
    /** The connected-agent transport's replica count and its relay payload cap (ADR-128). */
    connectedAgents: {
      replicaCount: Config.value(z.coerce.number().int().positive().default(1), {
        env: "LANGWATCH_APP_REPLICAS",
      }),
      relayMaxPayloadMb: Config.value(z.coerce.number().positive().optional(), {
        env: "LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB",
      }),
    },
  },
});

type ApiConfigProjection = ConfigValue<typeof apiConfigDefinition>;

/** The Postgres connection a process was configured with, if it was given one. */
export type ApiDatabaseConfigResolution = Readonly<{
  url: string | undefined;
}>;

/**
 * Present only when ALL of it is configured — a partial credential can't
 * connect, and would answer every statement with a failure instead of
 * reporting the surface unprovisioned.
 */
export type ApiLangWatchQLConfigResolution = Readonly<{
  url: string;
  username: string;
  password: string;
  database: string;
  tenantSetting: string;
}>;

/** The ClickHouse identities a process was configured with, if it was given any. */
export type ApiClickHouseConfigResolution = Readonly<{
  /** The application's own connection; absent means this process reads no analytics. */
  url: string | undefined;
  /** The restricted identity a member's own SQL runs as; absent means unprovisioned. */
  langwatchQl: ApiLangWatchQLConfigResolution | undefined;
  /**
   * The database the approved views read FROM, taken off this process's own connection
   * string. Resolved here rather than parsed at a call site: reading the deployment's
   * connection string is configuration, and a second parse is a second answer.
   */
  sourceDatabase: string | undefined;
  /**
   * The dedicated readonly account the operator EXPLAIN endpoint runs as;
   * absent means that endpoint is not served at all rather than falling back
   * to the application's own connection.
   */
  opsUrl: string | undefined;
  /**
   * The per-organization endpoints, keyed by organization id, from the
   * `CLICKHOUSE_URL__<label>__<organizationId>` variables every LangWatch tier
   * reads them by.
   */
  privateRoutes: readonly Readonly<{ organizationId: string; url: string; cluster: string }>[];
  /** Connection-pool sizing inputs, as the shared client resolves them. */
  poolSizing: PoolSizingInput;
}>;

/**
 * An unset allowlist is an empty one, never a wildcard — a wildcard from an
 * absent variable is how a fence stops fencing unintentionally.
 */
export type ApiModelProviderConfigResolution = Readonly<{
  isSaas: boolean;
  blockLocalHttpCalls: boolean;
  allowedProxyHosts: readonly string[];
  /**
   * A map, not named leaves — the one place that's right: which variable
   * carries a provider's key is the provider registry's business (sixteen
   * providers, custom ones too), whether it's set is the environment's.
   */
  environment: Readonly<Record<string, string | undefined>>;
}>;

export type ApiExecutionConfigResolution = Readonly<{
  /** Where the NLP engine answers; absent means no workflow or code evaluator runs. */
  nlpServiceUrl: string | undefined;
  /** Where the evaluator service answers; absent composes no evaluator runtime. */
  langevalsEndpoint: string | undefined;
  /** This deployment's public origin; absent means the studio cannot run a published workflow. */
  publicBaseUrl: string | undefined;
  /**
   * Projected off the observability leaf binding `LANGWATCH_ENDPOINT`. Absent
   * is real: a child must never guess and report a run to somebody else's
   * deployment.
   */
  langwatchEndpoint: string | undefined;
  /**
   * The terminal fallback model for a target that names none. Never blank: a
   * deployment that overrides nothing gets the registry flagship.
   */
  defaultModel: string;
}>;

/**
 * Blank rather than `undefined` — what the feature's adapter takes and its
 * `configured` flag is computed from, so "no App registered" reads as "not
 * connected" rather than a failure.
 */
export type ApiGithubConfigResolution = Readonly<{
  appId: string;
  privateKey: string;
  appSlug: string;
  webhookSecret: string;
  /** The Enterprise Server host, or absent for github.com. */
  host: string | undefined;
}>;

/** One organization's own S3 account, as a `DATAPLANE_S3__*` variable declares it. */
export type ApiDataplaneS3Route = Readonly<{
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}>;

/**
 * All four fields travel together because destination precedence reads all
 * four: a per-org route first, then the selected backend, shared bucket,
 * then the filesystem fallback.
 */
export type ApiStoredObjectsConfigResolution = Readonly<{
  backend: "s3" | "azure" | undefined;
  localFilesystemRoot: string | undefined;
  s3: Readonly<{
    bucket: string | undefined;
    endpoint: string | undefined;
    region: string | undefined;
    accessKeyId: string | undefined;
    secretAccessKey: string | undefined;
    sessionToken: string | undefined;
  }>;
  /**
   * The Azure Blob block, as read. Every rule about which of these a given
   * auth mode requires lives in `@langwatch/stored-object-server`, so this is
   * the raw shape its resolver takes rather than a validated credential.
   */
  azure: AzureBlobCredentialsConfig & { identity: AzureInjectedIdentity };
  /** Whether Azure Blob may host the transient trace spool on this deployment. */
  azureSpoolRetentionConfirmed: boolean;
  routes: ReadonlyMap<string, ApiDataplaneS3Route>;
}>;

/** How an Enterprise licence is verified on this deployment. */
export type ApiLicensingConfigResolution = Readonly<{
  /**
   * The rotated public key, or nothing (the embedded contract key). Blank is
   * not a key: reaching the verifier as `""` refuses every licence.
   */
  publicKey: string | undefined;
}>;

export type ApiInfrastructureConfig = Readonly<{
  database: ApiDatabaseConfigResolution;
  clickhouse: ApiClickHouseConfigResolution;
  execution: ApiExecutionConfigResolution;
  github: ApiGithubConfigResolution;
  licensing: ApiLicensingConfigResolution;
  modelProvider: ApiModelProviderConfigResolution;
  storedObjects: ApiStoredObjectsConfigResolution;
  redis: RedisConfigResolution;
  groupQueue: GroupQueuePolicy;
  /** The connected-agent transport's replica count and relay payload cap (ADR-128). */
  connectedAgents: Readonly<{
    /** The app replicas of this deployment; the no-Redis refusal threshold. */
    replicaCount: number;
    /** `LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB`; the default cap when absent. */
    relayMaxPayloadMb: number | undefined;
  }>;
}>;

/** The AuthZ decisions this process was configured with, already interpreted. */
export type ApiAuthzConfig = Readonly<{
  /** Whether an organization's permission reads may be served from the epoch cache. */
  epochCacheEnabled: boolean;
  /** The project every caller may read, where a deployment names one. */
  demoProjectId: string | undefined;
  /** The account that project's work is attributed to. */
  demoProjectUserId: string | undefined;
}>;

/**
 * Present only with a signing secret and base URL both named. Absent means
 * no Better Auth transport composed at all — never an instance built over a
 * guessed secret that silently signs everybody out.
 */
export type ApiBrowserSessionConfig = Readonly<{
  secret: string;
  baseUrl: string;
  publicBaseUrl: string | undefined;
  mfaEnrollmentOpen: boolean;
  passkeysEnabled: boolean;
  passkeyHandleSecret: string;
}>;

export type ApiShutdownConfig = Readonly<{
  /** The whole shutdown sequence's budget, listener drain included. */
  processDeadlineMs: number;
}>;

/**
 * `baseHost` rides alongside the mailer rather than inside it: the gateway
 * decides how a message leaves, the host what it can link to.
 */
export type ApiMailConfig = Readonly<{
  baseHost: string;
  mailer: MailerConfiguration;
}>;

/**
 * The studio's per-project Lambda deployment: the account, the image and the
 * network every per-project function is created in. The Lambda cleanup cron
 * reads only its three credential fields; the studio's execution half (see
 * `composeApiStudioHost`) reads the whole shape.
 */
export type ApiNlpLambdaFleetConfig = StudioLambdaConfig;

/**
 * `LANGWATCH_NLP_LAMBDA_CONFIG` is one JSON blob describing the studio's Lambda
 * deployment. Classified (it carries the account's own AWS credentials), so it
 * is parsed here, at this process's one boot seam for such variables — never
 * in the workflow feature itself, which stays pure functions over the result.
 */
const studioLambdaConfigSchema = z.object({
  AWS_REGION: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  role_arn: z.string().min(1),
  image_uri: z.string().min(1),
  cache_bucket: z.string().min(1),
  subnet_ids: z.array(z.string().min(1)),
  security_group_ids: z.array(z.string().min(1)),
});

/**
 * Whether `LANGWATCH_NLP_LAMBDA_CONFIG` was named at all, regardless of
 * whether it parsed. `composeApiStudioHost` refuses by name on a fleet that
 * was named but not usable, rather than quietly falling back to the shared
 * engine address — a distinct outcome from naming no fleet at all, which
 * `fleet` alone cannot tell apart from a malformed one.
 */
function resolveApiNlpLambdaFleetNamed(source: Readonly<Record<string, unknown>>): boolean {
  const raw = source.LANGWATCH_NLP_LAMBDA_CONFIG;
  return typeof raw === "string" && raw.trim() !== "";
}

function resolveNlpLambdaFleetConfig(
  source: Readonly<Record<string, unknown>>,
  langwatchEndpoint: string,
): ApiNlpLambdaFleetConfig | undefined {
  const raw = source.LANGWATCH_NLP_LAMBDA_CONFIG;
  if (typeof raw !== "string" || raw.trim() === "") return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    configLogger().warn(
      { envVar: "LANGWATCH_NLP_LAMBDA_CONFIG" },
      "Ignoring an unparseable NLP Lambda configuration; the Lambda fleet is not composed",
    );
    return undefined;
  }
  const fields = studioLambdaConfigSchema.safeParse(parsed);
  if (!fields.success) {
    configLogger().warn(
      { envVar: "LANGWATCH_NLP_LAMBDA_CONFIG" },
      "NLP Lambda configuration is incomplete; the Lambda fleet is not composed",
    );
    return undefined;
  }

  return buildStudioLambdaConfig({
    fields: {
      region: fields.data.AWS_REGION,
      accessKeyId: fields.data.AWS_ACCESS_KEY_ID,
      secretAccessKey: fields.data.AWS_SECRET_ACCESS_KEY,
      roleArn: fields.data.role_arn,
      imageUri: fields.data.image_uri,
      cacheBucket: fields.data.cache_bucket,
      subnetIds: fields.data.subnet_ids,
      securityGroupIds: fields.data.security_group_ids,
    },
    langwatchEndpoint,
    codeBlockTimeoutRawValue:
      typeof source.NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS === "string"
        ? source.NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS
        : undefined,
    stagingThresholdBytesRawValue: source.LANGEVALS_STAGING_THRESHOLD_BYTES,
    stagingTtlSecondsRawValue: source.LANGEVALS_STAGING_TTL_SECONDS,
  });
}

export type ApiConfig = Readonly<
  Omit<
    ApiConfigProjection,
    | "authz"
    | "billing"
    | "browserSession"
    | "infrastructure"
    | "mail"
    | "shutdown"
    | "validateTrpcOutput"
  > & {
    authz: ApiAuthzConfig;
    /**
     * The payment provider, present only when this deployment can both call
     * Stripe and verify what Stripe calls back with. Absent everywhere else,
     * which is what leaves the webhook route unmounted rather than mounted
     * over a client that cannot authenticate a delivery.
     */
    billing: ApiBillingConfig | undefined;
    /**
     * Whether this process checks every tRPC answer against the output schema
     * its procedure declares. Resolved here, once, so no surface below reads an
     * environment variable to find out. @see apiConfigDefinition
     */
    validateTrpcOutput: boolean;
    /** The deployment's one browser-session identity, or nothing. */
    browserSession: ApiBrowserSessionConfig | undefined;
    /** Absent when the deployment named no `BASE_HOST`; see `resolveApiMailConfig`. */
    mail?: ApiMailConfig;
    /**
     * Rollout switches, folded through the flag registry's own resolver so a
     * forced flag applies to every process, not whichever tier read it.
     */
    featureFlags: FeatureFlagConfig;
    infrastructure: ApiInfrastructureConfig;
    /**
     * A separate leaf from `observability` (that's the SDK's trace identity;
     * this is the OTLP collector's, for metrics) — configured independently.
     */
    otlpMetrics: OtlpMetricsExportOptions;
    /**
     * The retention a tenant's data is stamped with when no override exists in
     * its scope cascade. Read HERE and nowhere else: three compositions used
     * to resolve it from `process.env` at module scope.
     */
    platformDefaultRetentionDays: number;
    /**
     * The AWS account the studio's per-project NLP Lambda functions live in,
     * or nothing where the deployment fronts the engine with none, or named
     * one it did not describe (see `nlpLambdaFleetNamed`).
     */
    nlpLambdaFleet: ApiNlpLambdaFleetConfig | undefined;
    /**
     * True whenever the deployment named `LANGWATCH_NLP_LAMBDA_CONFIG` at all,
     * whether or not it parsed. `composeApiStudioHost` refuses a named-but-
     * unusable fleet by name rather than quietly falling back to the shared
     * engine address, which `nlpLambdaFleet` alone cannot distinguish from a
     * deployment that named no fleet.
     */
    nlpLambdaFleetNamed: boolean;
    shutdown: ApiShutdownConfig;
  }
>;

/** Parses executable configuration once, before API services are composed. */
export function resolveApiConfig(source: Readonly<Record<string, unknown>>): ApiConfig {
  const value = RuntimeConfig.create({
    name: "api",
    definition: apiConfigDefinition,
    source: {
      ...source,
      API_PORT: firstDefined(source, API_PORT_ENV_PRECEDENCE),
      CREDENTIALS_SECRET: firstDefined(source, STORED_SECRET_ENCRYPTION_KEY_ENV_PRECEDENCE),
      API_KEY_PEPPER: firstDefined(source, API_KEY_PEPPER_ENV_PRECEDENCE),
    },
  }).value;
  refuseApiSelfIngest(value);
  // All three or none: a deployment that set some of the gateway secrets boots
  // and then fails on its first virtual-key request, which reads as an outage
  // rather than as the configuration mistake it is.
  assertGatewaySecretsAllOrNone(source);
  // Destructured out of the spread rather than overwritten: the projection's
  // `mail` is the raw environment, and leaving it in place would put an
  // unresolved gateway on a deployment that named no `BASE_HOST`.
  const { mail: mailSource, ...rest } = value;
  const mail = resolveApiMailConfig(mailSource, value.infrastructure.execution.publicBaseUrl);
  const { billing: billingSource, ...withoutBilling } = rest;
  return {
    ...withoutBilling,
    ...(mail ? { mail } : {}),
    billing: resolveApiBillingConfig(billingSource),
    featureFlags: resolveFeatureFlagConfig(source),
    // Unset means "follow the deployment": on in development and test, off in
    // production, where a drifted schema must not turn a working read into a
    // failure. An explicit export wins either way.
    validateTrpcOutput: value.validateTrpcOutput ?? process.env.NODE_ENV !== "production",
    otlpMetrics: otlpMetricsExportOptionsFrom({
      telemetry: resolveTelemetryConfiguration(source),
      serviceName: value.serviceName,
    }),
    platformDefaultRetentionDays: resolvePlatformDefaultRetentionDays(environmentStrings(source)),
    nlpLambdaFleet: resolveNlpLambdaFleetConfig(
      source,
      value.infrastructure.execution.publicBaseUrl ?? "",
    ),
    nlpLambdaFleetNamed: resolveApiNlpLambdaFleetNamed(source),
    authz: {
      // The platform app's exact rule, so one variable means one thing across
      // the deployment rather than one thing per tier.
      epochCacheEnabled: value.authz.epochCache === "1" || value.authz.epochCache === "true",
      demoProjectId: value.authz.demoProjectId?.trim() || undefined,
      demoProjectUserId: value.authz.demoProjectUserId?.trim() || undefined,
    },
    browserSession: resolveBrowserSessionConfig({
      ...value.browserSession,
      publicUrl: value.infrastructure.execution.publicBaseUrl,
    }),
    shutdown: {
      processDeadlineMs:
        value.shutdown.deadlineMs ?? value.httpDrainGraceMs + PROCESS_CLOSE_SLACK_MS,
    },
    infrastructure: {
      database: { url: value.infrastructure.database.url },
      clickhouse: {
        url: value.infrastructure.clickhouse.url?.trim() || undefined,
        langwatchQl: resolveLangWatchQLConnection(value.infrastructure.clickhouse.langwatchQl),
        sourceDatabase: clickHouseDatabaseOf(value.infrastructure.clickhouse.url),
        opsUrl: value.infrastructure.clickhouse.opsUrl?.trim() || undefined,
        privateRoutes: resolvePrivateClickHouseRoutes(source),
        poolSizing: poolSizingFromEnv(environmentStrings(source)),
      },
      execution: {
        nlpServiceUrl: value.infrastructure.execution.nlpServiceUrl?.trim() || undefined,
        langevalsEndpoint: value.infrastructure.execution.langevalsEndpoint?.trim() || undefined,
        publicBaseUrl: value.infrastructure.execution.publicBaseUrl?.trim() || undefined,
        // The SAME variable the process's own telemetry is exported to, read
        // once and projected here: a prepared scenario child reports its run
        // events to the deployment's own collector.
        langwatchEndpoint: value.observability.endpoint?.trim() || undefined,
        // A blank override is not a model. It resolves to the registry
        // flagship rather than to an empty string, which a child would carry
        // to the provider as a model named "".
        defaultModel:
          value.infrastructure.execution.defaultModel?.trim() || REGISTRY_FLAGSHIP_MODEL,
      },
      modelProvider: resolveModelProviderConfig(
        value.infrastructure.modelProvider,
        environmentStrings(source),
      ),
      github: {
        appId: value.infrastructure.github.appId?.trim() ?? "",
        privateKey: value.infrastructure.github.privateKey?.trim() ?? "",
        appSlug: value.infrastructure.github.appSlug?.trim() ?? "",
        webhookSecret: value.infrastructure.github.webhookSecret?.trim() ?? "",
        host: value.infrastructure.github.host?.trim() || undefined,
      },
      licensing: {
        publicKey: value.infrastructure.licensing.publicKey?.trim() || undefined,
      },
      storedObjects: {
        backend: value.infrastructure.storedObjects.backend,
        localFilesystemRoot:
          value.infrastructure.storedObjects.localFilesystemRoot?.trim() || undefined,
        s3: {
          bucket: value.infrastructure.storedObjects.s3.bucket?.trim() || undefined,
          endpoint: value.infrastructure.storedObjects.s3.endpoint?.trim() || undefined,
          region: value.infrastructure.storedObjects.s3.region?.trim() || undefined,
          accessKeyId: value.infrastructure.storedObjects.s3.accessKeyId?.trim() || undefined,
          secretAccessKey:
            value.infrastructure.storedObjects.s3.secretAccessKey?.trim() || undefined,
          sessionToken: value.infrastructure.storedObjects.s3.sessionToken?.trim() || undefined,
        },
        azure: {
          backend: value.infrastructure.storedObjects.backend,
          authMode: value.infrastructure.storedObjects.azure.authMode?.trim() || undefined,
          accountName: value.infrastructure.storedObjects.azure.accountName?.trim() || undefined,
          accountKey: value.infrastructure.storedObjects.azure.accountKey?.trim() || undefined,
          container: value.infrastructure.storedObjects.azure.container?.trim() || undefined,
          endpoint: value.infrastructure.storedObjects.azure.endpoint?.trim() || undefined,
          authorityHost:
            value.infrastructure.storedObjects.azure.authorityHost?.trim() || undefined,
          tokenAudience:
            value.infrastructure.storedObjects.azure.tokenAudience?.trim() || undefined,
          // The escape hatch is refused outright in production, so a value set
          // on a real deployment cannot put a bearer token on the wire in
          // plaintext no matter who sets it. This is where that is decided:
          // the guard downstream is handed a boolean, not a variable to read.
          allowInsecureTokenEndpointForTests:
            process.env.NODE_ENV !== "production" &&
            value.infrastructure.storedObjects.azure.allowInsecureTokenEndpointForTests?.trim() ===
              "1",
          identity: {
            tenantId:
              value.infrastructure.storedObjects.azure.identity.tenantId?.trim() || undefined,
            clientId:
              value.infrastructure.storedObjects.azure.identity.clientId?.trim() || undefined,
            federatedTokenFile:
              value.infrastructure.storedObjects.azure.identity.federatedTokenFile?.trim() ||
              undefined,
          },
        },
        azureSpoolRetentionConfirmed:
          value.infrastructure.storedObjects.azureSpoolRetentionConfirmed,
        routes: resolveDataplaneS3Routes(source),
      },
      redis: new RedisConfigService().resolve(value.infrastructure.redis),
      groupQueue: resolveGroupQueuePolicyFromEnv(value.infrastructure.groupQueue),
      connectedAgents: {
        replicaCount: value.infrastructure.connectedAgents.replicaCount,
        relayMaxPayloadMb: value.infrastructure.connectedAgents.relayMaxPayloadMb,
      },
    },
  };
}

/**
 * Refuses a boot whose telemetry exporter points back at this deployment —
 * that feedback loop is the one case the check guards; exporting to a
 * DIFFERENT LangWatch install is a supported shape and stays allowed.
 */
function refuseApiSelfIngest(value: ApiConfigProjection): void {
  assertObservabilityDoesNotSelfIngest({
    runtime: "api",
    apiKeyEnv: "LANGWATCH_API_KEY",
    apiKey: value.observability.apiKey,
    endpointEnv: "LANGWATCH_ENDPOINT",
    endpoint: value.observability.endpoint,
    deployment: [
      { env: "BASE_HOST", value: value.infrastructure.execution.publicBaseUrl },
      { env: "NEXTAUTH_URL", value: value.browserSession.url },
      { env: "API_HOST/API_PORT", value: value.host, port: value.port },
    ],
  });
}

/**
 * What this process needs to bill through Stripe. The two credentials are the
 * whole gate: without the secret key nothing can be charged, and without the
 * signing secret a delivery cannot be told apart from an attacker's POST.
 */
export type ApiBillingConfig = Readonly<{
  stripeSecretKey: string;
  /** Verified over the raw bytes, per request, so a rotation needs no restart. */
  stripeWebhookSecret: string;
  /** The payment link a self-hosted licence purchase arrives on, where one is sold. */
  licensePaymentLinkId: string | undefined;
  /** Signs an issued licence key; absent means a licence checkout cannot be fulfilled. */
  licensePrivateKey: string | undefined;
  /** Where the operators' billing notices go, if this deployment named a channel. */
  slackSubscriptionsChannel: string | undefined;
}>;

/**
 * Nothing unless BOTH credentials are present. Half a Stripe configuration is
 * the shape that boots and then refuses every delivery, which reads as an
 * outage rather than as the configuration mistake it is.
 */
function resolveApiBillingConfig(
  billing: ApiConfigProjection["billing"],
): ApiBillingConfig | undefined {
  const stripeSecretKey = billing.stripeSecretKey?.trim();
  const stripeWebhookSecret = billing.stripeWebhookSecret?.trim();
  if (!stripeSecretKey || !stripeWebhookSecret) return undefined;

  return {
    stripeSecretKey,
    stripeWebhookSecret,
    licensePaymentLinkId: billing.licensePaymentLinkId?.trim() || undefined,
    licensePrivateKey: billing.licensePrivateKey?.trim() || undefined,
    slackSubscriptionsChannel: billing.slackSubscriptionsChannel?.trim() || undefined,
  };
}

/**
 * Nothing when `BASE_HOST` is absent or blank — same rule the worker applies
 * (`resolveWorkerMailConfig`) — since the sender address and reset link both
 * derive from it.
 */
function resolveApiMailConfig(
  mail: ApiConfigProjection["mail"],
  publicBaseUrl: string | undefined,
): ApiMailConfig | undefined {
  const baseHost = publicBaseUrl?.trim();
  if (!baseHost) return undefined;

  return {
    baseHost,
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
 * Both halves required together, neither defaulted: either alone would
 * compose an instance that rejects every session while looking configured.
 */
function resolveBrowserSessionConfig(
  value: Readonly<{
    secret: string | undefined;
    url: string | undefined;
    publicUrl: string | undefined;
    mfaEnrollmentOpen: string | undefined;
    passkeysEnabled: string | undefined;
    passkeyHandleSecret: string | undefined;
  }>,
): ApiBrowserSessionConfig | undefined {
  const secret = value.secret?.trim() || undefined;
  const baseUrl = value.url?.trim() || undefined;
  if (!secret || !baseUrl) return undefined;

  return {
    secret,
    baseUrl,
    publicBaseUrl: value.publicUrl?.trim() || undefined,
    // The platform app reads both as the literal string "on", so this one
    // does too: a plugin mounted in one process and not another is a route
    // that exists for half the fleet.
    mfaEnrollmentOpen: value.mfaEnrollmentOpen?.trim() === "on",
    passkeysEnabled: value.passkeysEnabled?.trim() === "on",
    passkeyHandleSecret: value.passkeyHandleSecret?.trim() || secret,
  };
}

/**
 * `isSaas` reads `"1"`/`"true"` as on, everything else (including `"yes"`)
 * off — the platform app's rule. Allowlist entries are split, trimmed, and
 * blank ones dropped so an empty host can't sit in the list looking like one.
 */
function resolveModelProviderConfig(
  value: Readonly<{
    isSaas: string | undefined;
    blockLocalHttpCalls: boolean;
    allowedProxyHosts: string | undefined;
  }>,
  environment: Readonly<Record<string, string | undefined>>,
): ApiModelProviderConfigResolution {
  return {
    isSaas: isEnabledFlag(value.isSaas),
    blockLocalHttpCalls: value.blockLocalHttpCalls,
    allowedProxyHosts:
      value.allowedProxyHosts
        ?.split(",")
        .map((host) => host.trim())
        .filter((host) => host.length > 0) ?? [],
    environment,
  };
}

/** The platform app's exact reading of a boolean environment variable. */
function isEnabledFlag(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

/**
 * The restricted identity, or nothing — never half of one. A partial set
 * means the workbench was meant to run; the omission is named (var names
 * only, one of these is a password).
 */
/**
 * The database an unqualified table name resolves to on this process's own ClickHouse:
 * the connection URL's path. A malformed or absent URL answers nothing rather than a
 * guess — the surfaces that need it already refuse without a ClickHouse at all.
 */
function clickHouseDatabaseOf(url: string | undefined): string | undefined {
  const trimmed = url?.trim();
  if (!trimmed) return undefined;
  try {
    const database = new URL(trimmed).pathname.replace(/^\//, "");
    return database.length > 0 ? database : undefined;
  } catch {
    return undefined;
  }
}

function resolveLangWatchQLConnection(
  value: Readonly<{
    url: string | undefined;
    username: string | undefined;
    password: string | undefined;
    database: string | undefined;
    tenantSetting: string | undefined;
  }>,
): ApiLangWatchQLConfigResolution | undefined {
  const required = [
    ["LWQL_CLICKHOUSE_URL", value.url],
    ["LWQL_CLICKHOUSE_USER", value.username],
    ["LWQL_CLICKHOUSE_PASSWORD", value.password],
    ["LWQL_DATABASE", value.database],
    ["LWQL_TENANT_SETTING", value.tenantSetting],
  ] as const;
  const absent = required.filter(([, entry]) => !entry?.trim()).map(([name]) => name);

  if (absent.length > 0) {
    if (absent.length < required.length) {
      configLogger().warn(
        { absent },
        "LangWatchQL is partially configured, so every statement will be refused",
      );
    }
    return undefined;
  }
  // Re-checked rather than asserted: `absent` is computed by a callback, which
  // TypeScript cannot use to narrow these five.
  const { url, username, password, database, tenantSetting } = value;
  if (!url || !username || !password || !database || !tenantSetting) return undefined;
  return { url, username, password, database, tenantSetting };
}

/**
 * Malformed entries are skipped, not fatal; an ambiguous split is reported,
 * since guessing wrong silently fails a tenant open onto the shared instance.
 */
function resolvePrivateClickHouseRoutes(
  source: Readonly<Record<string, unknown>>,
): readonly Readonly<{ organizationId: string; url: string; cluster: string }>[] {
  const table = parseRoutingTable(environmentStrings(source));
  for (const skipped of table.skipped) {
    configLogger().warn(
      { envVar: skipped.envVar, reason: skipped.reason },
      "Ignoring a malformed ClickHouse route variable",
    );
  }
  for (const guess of table.ambiguous) {
    configLogger().warn(
      { envVar: guess.envVar, organizationId: guess.organizationId },
      "A ClickHouse route variable was split by guess; rename it if that is not the intent",
    );
  }
  return [...table.routes].map(([organizationId, url]) => ({
    organizationId,
    url,
    cluster: organizationId,
  }));
}

/** The environment bag as the shared ClickHouse helpers read it. */
function environmentStrings(
  source: Readonly<Record<string, unknown>>,
): Record<string, string | undefined> {
  const strings: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(source)) {
    if (typeof value === "string") strings[name] = value;
  }
  return strings;
}

/**
 * Delegates to `loggerConfigurationFrom` so every process folds its parsed
 * config through the same one-place mapping, never a raw environment source.
 */
export function apiLoggerConfiguration(config: ApiConfig): LoggerConfiguration {
  return loggerConfigurationFrom(config);
}

/** Builds SDK setup from parsed semantic configuration before boot side effects. */
export function apiObservabilityConfiguration(config: ApiConfig): ProcessObservabilityOptions {
  const langwatch = config.observability.apiKey
    ? {
        apiKey: config.observability.apiKey,
        endpoint: config.observability.endpoint,
        processorType: config.observability.processorType,
      }
    : ("disabled" as const);

  return {
    serviceName: config.serviceName,
    loggerName: config.serviceName,
    setup: {
      langwatch,
      attributes: {
        "deployment.environment.name": config.environment,
        ...(config.serviceVersion ? { "service.version": config.serviceVersion } : {}),
      },
    },
  };
}

function firstDefined(
  source: Readonly<Record<string, unknown>>,
  names: readonly string[],
): unknown {
  for (const name of names) {
    const value = source[name];
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Parsed by the shared helper, not a second reader: a process splitting
 * `DATAPLANE_S3__<label>__<organizationId>` differently from another would
 * address a tenant's objects somewhere it can't read them.
 */
function resolveDataplaneS3Routes(
  source: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, ApiDataplaneS3Route> {
  const table = parseDataplaneS3RoutingTable(source);
  for (const skipped of table.skipped) {
    configLogger().warn(
      { envVar: skipped.envVar, reason: skipped.reason },
      "Ignoring a malformed private S3 route variable",
    );
  }
  return table.routes;
}
