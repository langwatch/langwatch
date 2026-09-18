import { resolveUiBundle, type ApiUiBundle } from "./door/api-ui-bundle.ts";

import { agentServerConfigDefinition } from "@langwatch/agent-contract";
import {
  analyticsServerConfigDefinition,
  assertAnalyticsServerConfig,
} from "@langwatch/analytics-contract";
import { apiKeyServerConfigDefinition } from "@langwatch/api-key-contract";
import { assertAuthServerConfig, authServerConfigDefinition } from "@langwatch/auth-contract";
import { authzServerConfigDefinition } from "@langwatch/authz-contract";
import {
  parseRoutingTable,
  poolSizingFromEnv,
  type PoolSizingInput,
} from "@langwatch/clickhouse-client";
import {
  deploymentPublicBaseUrl,
  assertObservabilityDoesNotSelfIngest,
  clickhouseConfigDefinition,
  Config,
  environmentBooleanSchema,
  groupQueueConfigDefinition,
  loggerConfigDefinition,
  observabilityConfigDefinition,
  mergeClickHousePrivateRoutes,
  parseDataplaneS3RoutingTable,
  postgresConfigDefinition,
  redisConfigDefinition,
  requestBoundsConfigDefinition,
  resolveRequestBoundsOverrides,
  resolveTelemetryConfiguration,
  runtimeIdentityConfigDefinition,
  RuntimeConfig,
  portSchema,
  type ConfigValue,
} from "@langwatch/config";
import {
  dataRetentionServerConfigDefinition,
  resolvePlatformDefaultRetentionDays,
} from "@langwatch/data-retention-contract";
import {
  assertBillingServerConfig,
  billingServerConfigDefinition,
} from "@langwatch/enterprise-billing-contract";
import { licensingServerConfigDefinition } from "@langwatch/enterprise-licensing-contract";
import { managedProviderServerConfigDefinition } from "@langwatch/enterprise-managed-provider-contract";
import { saasServerConfigDefinition } from "@langwatch/enterprise-saas-contract";
import { scimServerConfigDefinition } from "@langwatch/enterprise-scim-contract";
import { evaluationServerConfigDefinition } from "@langwatch/evaluation-contract";
import { resolveFeatureFlagConfig, type FeatureFlagConfig } from "@langwatch/feature-flag-contract";
import {
  assertGatewaySecretsAllOrNone,
  gatewayServerConfigDefinition,
} from "@langwatch/gateway-contract";
import { githubServerConfigDefinition } from "@langwatch/github-contract";
import { resolveGroupQueuePolicyFromEnv, type GroupQueuePolicy } from "@langwatch/group-queue";
import { serverModules } from "@langwatch/installed-modules/server";
import { langyServerConfigDefinition } from "@langwatch/langy-contract";
import {
  modelProviderServerConfigDefinition,
  getLatestOpenAIChatFlagship,
} from "@langwatch/model-provider-contract";
import { notificationServerConfigDefinition } from "@langwatch/notification-contract";
import { EmailProviderService, type MailerConfiguration } from "@langwatch/notification-process";
import {
  createLogger,
  loggerConfigurationFrom,
  type Logger,
  type LoggerConfiguration,
} from "@langwatch/observability";
import {
  otlpMetricsExportOptionsFrom,
  type OtlpMetricsExportOptions,
  type ProcessObservabilityOptions,
} from "@langwatch/observability/node";
import { opsServerConfigDefinition } from "@langwatch/ops-contract";
import type { RequestBoundsOverrides } from "@langwatch/plans";
import { platformHealthServerConfigDefinition } from "@langwatch/platform-health-contract";
import { producerEventing, type MailConfig, type ProcessConfig } from "@langwatch/process-stores";
import { RedisConfigService, type RedisConfigResolution } from "@langwatch/redis-client";
import { secretServerConfigDefinition } from "@langwatch/secret-contract";
import { storedObjectServerConfigDefinition } from "@langwatch/stored-object-contract";
import type {
  AzureBlobCredentialsConfig,
  AzureInjectedIdentity,
} from "@langwatch/stored-object-process";
import { workflowServerConfigDefinition } from "@langwatch/workflow-contract";
import {
  HttpWorkflowNlpRuntimeAdapter,
  buildStudioLambdaConfig,
  type StudioLambdaConfig,
} from "@langwatch/workflow-process";
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
  legacySsoStringWritesRetired: Config.value(
    z
      .string()
      .optional()
      .transform((value) => (value === void 0 ? void 0 : value === "enforce")),
    { env: "SSOCONN_ROUTING" },
  ),
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
   * The provisioning family's instance-administrator bearer token. Composed
   * into {@link ApiInternalAuthConfig} below with the other two, which is how
   * the process hands them to its doors.
   */
  instanceAdminApiKey: Config.value(optionalEnvironmentString, {
    env: "LANGWATCH_INSTANCE_ADMIN_API_KEY",
  }),
  /** The internal cron family's bearer token. @see instanceAdminApiKey */
  cronApiKey: Config.value(optionalEnvironmentString, {
    env: "CRON_API_KEY",
  }),
  /**
   * Resolved from {@link STORED_SECRET_ENCRYPTION_KEY_ENV_PRECEDENCE}.
   * Blank-vs-wrong-shape is the cipher's own rule to enforce.
   */
  storedSecretEncryptionKey: secretServerConfigDefinition.encryptionKey,
  /**
   * A separate leaf from the cipher key above: this is the HMAC key
   * VERBATIM, never the decoded bytes, so the two rotate independently.
   */
  apiKeyPepper: apiKeyServerConfigDefinition.pepper,
  /**
   * Separate from the API-key pepper — virtual keys rotate independently.
   * Blank is fine: `VirtualKeyCryptoAdapter` fails at first hash, not boot.
   */
  virtualKeyPepper: gatewayServerConfigDefinition.virtualKeyPepper,
  /**
   * Verified by `/api/internal/gateway` before any handler runs. Blank
   * answers 500 `gateway_internal_secret_missing` rather than falling open.
   */
  gatewayInternalSecret: gatewayServerConfigDefinition.internalSecret,
  /**
   * Signs short-lived JWTs handed to the data plane — separate from the
   * HMAC secret above (that's IN, this is OUT), rotated independently.
   */
  gatewayJwtSecret: gatewayServerConfigDefinition.jwtSecret,
  /**
   * How long after a request an outcome may still arrive, in milliseconds.
   * Parsed by the gateway package's `settlementGraceMs`, which this raw value
   * feeds, so the REST policy and the settlement sweeper never disagree.
   */
  spendSettlementGraceMs: gatewayServerConfigDefinition.spendSettlementGraceMs,
  /**
   * The metrics-scrape bearer, under the name every LangWatch tier reads it
   * by. Blank means unconfigured, which in production means no metrics
   * endpoint served.
   */
  metricsApiKey: opsServerConfigDefinition.metricsApiKey,
  /** The agent manager's address and callback bearer; the schema refuses an address alone. */
  langy: langyServerConfigDefinition,
  /**
   * `auth0WebhookSecret` blank answers 404, not 401 — an unconfigured
   * install looks unrouted. `provenOffboarding` (`SCIM_V2_GRANTS`) is a
   * CONSTRUCTION input, not a per-tenant flag: one offboarding path per process.
   */
  scim: { ...scimServerConfigDefinition },
  /**
   * The ClickHouse EXPLAIN endpoint's operator secret. Blank means the
   * endpoint is not registered — no way to reach a cross-tenant EXPLAIN by
   * presenting nothing.
   */
  opsApiKey: opsServerConfigDefinition.apiKey,
  /**
   * The external monitor's key and the project credential its canaries are
   * sent with. Both refused blank; with either absent the platform-health
   * family is not mounted, so presenting nothing cannot reach a probe.
   */
  platformHealth: { ...platformHealthServerConfigDefinition },
  /**
   * `AUTHZ_EPOCH_CACHE` reads "1 or true, else off" like the platform app.
   * `DEMO_PROJECT_ID` blank means no demo project, never `""`.
   */
  authz: { ...authzServerConfigDefinition },
  /**
   * `secret` is `NEXTAUTH_SECRET` verbatim, never derived from the cipher
   * key. `url` is not re-bound from `publicBaseUrl`.
   */
  browserSession: { ...authServerConfigDefinition },
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
    adminEmails: saasServerConfigDefinition.adminEmails,
  },
  /**
   * Same env vars as the worker's mail config, so sender domains agree on
   * SPF. `BASE_HOST` is read from `publicBaseUrl`, not re-bound here.
   */
  mail: { ...notificationServerConfigDefinition },
  /**
   * The payment provider, under the names every LangWatch tier already reads
   * them by. Every leaf is optional; `resolveApiBillingConfig` answers nothing
   * rather than letting a half-configured Stripe boot an unverifiable webhook.
   */
  billing: { ...billingServerConfigDefinition },
  /** The retention every tenant is stamped with when its cascade names none. */
  dataRetention: { ...dataRetentionServerConfigDefinition },
  /**
   * Boot overrides for the central request-bounds registry, read at the one
   * spelling `@langwatch/config` validates: unknown keys and non-positive
   * values refuse this process's boot, and both processes project one record.
   */
  requestBounds: { ...requestBoundsConfigDefinition },
  /** The studio's per-project Lambda fleet, and the engine's staging bounds. */
  workflow: { ...workflowServerConfigDefinition },
  /** Every managed Bedrock deployment this install serves, keyed by organization. */
  managedProvider: { ...managedProviderServerConfigDefinition },
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
      opsUrl: opsServerConfigDefinition.clickhouseOpsUrl,
      langwatchQl: { ...analyticsServerConfigDefinition.langwatchQl },
    },
    /**
     * Absent execution addresses refuse at the call, not at boot — a
     * supported read-only shape. `publicBaseUrl` is the public origin, not
     * this listener's bind address (they differ behind a proxy).
     */
    execution: {
      langevalsEndpoint: evaluationServerConfigDefinition.langevalsEndpoint,
      publicBaseUrl: deploymentPublicBaseUrl,
    },
    /**
     * `isSaas` gates SYSTEM providers explicitly, never inferred from an
     * `OPENAI_API_KEY` a self-hosted install happens to export.
     */
    modelProvider: {
      isSaas: saasServerConfigDefinition.isSaas,
      ...modelProviderServerConfigDefinition,
    },
    /**
     * All five optional and read together: none set reads as "not connected"
     * via the feature's `configured` flag, not a call failure. `host` is
     * empty for github.com, the Enterprise Server host otherwise.
     */
    github: { ...githubServerConfigDefinition },
    /**
     * Optional; absent is normal since the licensing contract embeds the
     * production public key. Exists for ROTATION. The worker reads the SAME
     * variable (ADR-027) so both processes agree on whether it's licensed.
     */
    licensing: { ...licensingServerConfigDefinition },
    /**
     * BACKEND is a selection, not a fallback chain: naming `azure` never
     * silently resolves to a configured S3 bucket instead.
     */
    storedObjects: { ...storedObjectServerConfigDefinition },
    redis: { ...redisConfigDefinition },
    groupQueue: { ...groupQueueConfigDefinition },
    /** The connected-agent transport's replica count and its relay payload cap (ADR-128). */
    connectedAgents: { ...agentServerConfigDefinition },
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
   * auth mode requires lives in `@langwatch/stored-object-process`, so this is
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
 * The studio's per-project Lambda deployment: the account, image and network
 * every per-project function is created in. The cleanup cron reads only its
 * credential fields; the execution half reads the whole shape.
 */
export type ApiNlpLambdaFleetConfig = StudioLambdaConfig;

/**
 * `LANGWATCH_NLP_LAMBDA_CONFIG` is one JSON document describing the studio's
 * Lambda deployment, parsed by the workflow feature's own leaf at boot; this
 * only turns the parsed fields into the shape the studio host takes.
 */
function resolveNlpLambdaFleetConfig(
  workflow: ApiConfigProjection["workflow"],
  langwatchEndpoint: string,
): ApiNlpLambdaFleetConfig | undefined {
  const fields = workflow.nlpLambdaFleet;
  if (!fields) return undefined;

  return buildStudioLambdaConfig({
    fields: {
      region: fields.AWS_REGION,
      accessKeyId: fields.AWS_ACCESS_KEY_ID,
      secretAccessKey: fields.AWS_SECRET_ACCESS_KEY,
      roleArn: fields.role_arn,
      imageUri: fields.image_uri,
      cacheBucket: fields.cache_bucket,
      subnetIds: fields.subnet_ids,
      securityGroupIds: fields.security_group_ids,
    },
    langwatchEndpoint,
    codeBlockTimeoutRawValue: workflow.codeBlockTimeoutSeconds,
    stagingThresholdBytesRawValue: workflow.stagingThresholdBytes,
    stagingTtlSecondsRawValue: workflow.stagingTtlSeconds,
  });
}

/**
 * The static bearers this process opens its internal doors on. The names are
 * the transport chain's own, so the whole object goes through `withStaticTokens`
 * and no main picks it apart key by key.
 */
export type ApiInternalAuthConfig = Readonly<{
  /** The internal cron family's bearer token. */
  cronBearerToken: string | undefined;
  /** The Langy agent manager's callback bearer token. */
  langyInternalBearerToken: string | undefined;
  /** The instance administrator's bearer token, unset on SaaS. */
  instanceAdminBearerToken: string | undefined;
}>;

export type ApiConfig = Readonly<
  Omit<
    ApiConfigProjection,
    | "authz"
    | "billing"
    | "browserSession"
    | "dataRetention"
    | "cronApiKey"
    | "infrastructure"
    | "instanceAdminApiKey"
    | "langy"
    | "mail"
    | "requestBounds"
    | "shutdown"
    | "validateTrpcOutput"
    | "workflow"
  > & {
    authz: ApiAuthzConfig;
    /**
     * Boot overrides for the central request-bounds registry (`@langwatch/plans`),
     * validated against its keys at parse time. Empty when the deployment
     * named none; the entitlement module merges them over the tier values.
     */
    requestBounds: RequestBoundsOverrides;
    /**
     * The payment provider, present only when this deployment can both call
     * Stripe and verify what it calls back with. Absent otherwise, which
     * leaves the webhook route unmounted rather than unable to authenticate.
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
    /**
     * The Langy agent's callback bearer. Blank answers 503 `Not configured`
     * rather than falling open — a deployment with no Langy agent needs none.
     */
    langyInternalSecret: string | undefined;
    /**
     * The bearer tokens this deployment answers its own internal doors on,
     * as one object the transport chain takes whole. @see ApiInternalAuthConfig
     */
    internalAuth: ApiInternalAuthConfig;
    /**
     * The built browser application served off the same listener. Absent
     * where this build carries none, and Vite owns the browser instead.
     */
    ui: ApiUiBundle | undefined;
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
     * or nothing where the deployment fronts the engine with none. A fleet
     * named but not described never gets here — the workflow leaf refuses that boot.
     */
    nlpLambdaFleet: ApiNlpLambdaFleetConfig | undefined;
    /**
     * True whenever the deployment named `LANGWATCH_NLP_LAMBDA_CONFIG` at all.
     * A named-but-unusable fleet now refuses the boot, so this agrees with
     * `nlpLambdaFleet`; stays declared until the studio host is rewired.
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
  // Every rule that spans more than one leaf, refused here rather than at
  // first use: each one names a deployment that boots and then fails on a
  // request, which reads as an outage rather than as the mistake it is.
  assertGatewaySecretsAllOrNone(source);
  assertAuthServerConfig(value.browserSession);
  assertBillingServerConfig(value.billing);
  assertAnalyticsServerConfig({ langwatchQl: value.infrastructure.clickhouse.langwatchQl });
  // Destructured out of the spread rather than overwritten: the projection's
  // `mail` is the raw environment, and leaving it in place would put an
  // unresolved gateway on a deployment that named no `BASE_HOST`.
  const { mail: mailSource, ...rest } = value;
  const mail = resolveApiMailConfig(mailSource, value.infrastructure.execution.publicBaseUrl);
  const {
    billing: billingSource,
    cronApiKey,
    instanceAdminApiKey,
    langy,
    requestBounds: requestBoundsConfig,
    ...withoutBilling
  } = rest;
  return {
    ...withoutBilling,
    requestBounds: resolveRequestBoundsOverrides(requestBoundsConfig),
    langyInternalSecret: langy.internalSecret,
    // Frozen: the chain, both doors and every family read the same object,
    // and a reader that could edit it could open a door nobody configured.
    internalAuth: Object.freeze({
      cronBearerToken: cronApiKey,
      langyInternalBearerToken: langy.internalSecret,
      instanceAdminBearerToken: instanceAdminApiKey,
    }),
    // The two values the browser projection is built on come from THIS parse,
    // not from a second read of the environment: one deployment, one answer
    // for what its base address and mode are.
    ui: resolveUiBundle({
      ...source,
      BASE_HOST: value.infrastructure.execution.publicBaseUrl,
      NODE_ENV: value.nodeEnvironment,
    }),
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
    platformDefaultRetentionDays: resolvePlatformDefaultRetentionDays({
      LANGWATCH_DEFAULT_RETENTION_DAYS: value.dataRetention.platformDefaultDays,
      NODE_ENV: value.nodeEnvironment,
    }),
    nlpLambdaFleet: resolveNlpLambdaFleetConfig(
      value.workflow,
      value.infrastructure.execution.publicBaseUrl ?? "",
    ),
    nlpLambdaFleetNamed: value.workflow.nlpLambdaFleet !== undefined,
    authz: value.authz,
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
        nlpServiceUrl: value.infrastructure.modelProvider.nlpServiceUrl,
        langevalsEndpoint: value.infrastructure.execution.langevalsEndpoint?.trim() || undefined,
        publicBaseUrl: value.infrastructure.execution.publicBaseUrl?.trim() || undefined,
        // The SAME variable the process's own telemetry is exported to, read
        // once and projected here: a prepared scenario child reports its run
        // events to the deployment's own collector.
        langwatchEndpoint: value.observability.endpoint?.trim() || undefined,
        // A blank override is not a model. It resolves to the registry
        // flagship rather than to an empty string, which a child would carry
        // to the provider as a model named "".
        defaultModel: value.infrastructure.modelProvider.defaultModel ?? REGISTRY_FLAGSHIP_MODEL,
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
      licensing: value.infrastructure.licensing,
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
      { env: "NEXTAUTH_URL", value: value.browserSession.sessionUrl },
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
    sessionSecret: string | undefined;
    sessionUrl: string | undefined;
    publicUrl: string | undefined;
    mfaEnrollmentOpen: boolean;
    passkeysEnabled: boolean;
    passkeyHandleSecret: string | undefined;
  }>,
): ApiBrowserSessionConfig | undefined {
  const secret = value.sessionSecret?.trim() || undefined;
  const baseUrl = value.sessionUrl?.trim() || undefined;
  if (!secret || !baseUrl) return undefined;

  return {
    secret,
    baseUrl,
    publicBaseUrl: value.publicUrl?.trim() || undefined,
    mfaEnrollmentOpen: value.mfaEnrollmentOpen,
    passkeysEnabled: value.passkeysEnabled,
    passkeyHandleSecret: value.passkeyHandleSecret?.trim() || secret,
  };
}

/** Every reading is the feature's own; this only adds the process's env bag. */
function resolveModelProviderConfig(
  value: Readonly<{
    isSaas: boolean;
    blockLocalHttpCalls: boolean;
    allowedProxyHosts: readonly string[];
  }>,
  environment: Readonly<Record<string, string | undefined>>,
): ApiModelProviderConfigResolution {
  return {
    isSaas: value.isSaas,
    blockLocalHttpCalls: value.blockLocalHttpCalls,
    allowedProxyHosts: value.allowedProxyHosts,
    environment,
  };
}

// Resolve unqualified table names to ClickHouse database from URL path.
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
  return mergeClickHousePrivateRoutes({
    declared: environmentStrings(source).CLICKHOUSE_PRIVATE_ROUTES,
    perCustomer: [...table.routes].map(([organizationId, url]) => ({ organizationId, url })),
    report: configLogger(),
  }).map((route) => ({ ...route, cluster: route.organizationId }));
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

const DEFAULT_RATE_ALLOWANCE = { requests: 60, seconds: 60 };

export function apiModuleConfig(config: ApiConfig) {
  const publicBaseUrl = z.url().parse(config.infrastructure.execution.publicBaseUrl);

  const slices = {
    agent: {
      publicBaseUrl,
      connected: config.infrastructure.connectedAgents,
    },
    analytics: {
      langwatchQl: config.infrastructure.clickhouse.langwatchQl ?? {},
      publicBaseUrl,
    },
    auth: {
      processName: config.serviceName,
      ...(config.browserSession ? { browserSession: config.browserSession } : {}),
      isSaas: config.infrastructure.modelProvider.isSaas,
    },
    "api-key": { pepper: config.apiKeyPepper },
    dashboard: { baseHost: publicBaseUrl },
    "data-retention": {
      platformDefaultRetentionDays: config.platformDefaultRetentionDays,
    },

    "feature-flag": config.featureFlags,
    gateway: {
      internalSecret: config.gatewayInternalSecret,
      jwtSecret: config.gatewayJwtSecret,
      virtualKeyPepper: config.virtualKeyPepper,
      spendSettlementGraceMs: config.spendSettlementGraceMs,
    },
    "managed-provider": { bedrock: config.managedProvider.bedrock },
    user: {
      passkeysEnabled: config.browserSession?.passkeysEnabled ?? false,
      baseUrl: config.browserSession?.publicBaseUrl ?? null,
    },
    entitlement: {
      processName: config.serviceName,
      isSaas: config.infrastructure.modelProvider.isSaas,
      requestBounds: config.requestBounds,
    },
    suite: { publicBaseUrl },
    dataset: { publicBaseUrl },
    evaluator: { publicBaseUrl },
    scenario: { publicBaseUrl },
    github: {
      appId: config.infrastructure.github.appId || void 0,
      privateKey: config.infrastructure.github.privateKey || void 0,
      appSlug: config.infrastructure.github.appSlug || void 0,
      webhookSecret: config.infrastructure.github.webhookSecret || void 0,
      host: config.infrastructure.github.host || void 0,
    },
    "hosted-mcp": { baseHost: publicBaseUrl },
    identity: {
      adminEmails: (config.deployment.adminEmails ?? "")
        .split(",")
        .map((email) => email.trim())
        .filter((email) => email.length > 0),
    },

    organization: {
      processName: config.serviceName,
      demoProject: {
        userId: config.authz.demoProjectUserId ?? "",
        projectId: config.authz.demoProjectId ?? "",
      },
      baseHost: publicBaseUrl,
    },
    ops: {
      adminEmails: (config.deployment.adminEmails ?? "")
        .split(",")
        .map((email) => email.trim())
        .filter((email) => email.length > 0),
      ...(config.opsApiKey ? { opsApiKey: config.opsApiKey } : {}),
      ...(config.infrastructure.clickhouse.opsUrl
        ? { opsClickHouseUrl: config.infrastructure.clickhouse.opsUrl }
        : {}),
      isProduction: config.nodeEnvironment === "production",

      legacySsoStringWritesRetired: config.legacySsoStringWritesRetired,
    },
    langy: { internalSecret: config.langyInternalSecret },
    "model-provider": {
      isSaas: config.infrastructure.modelProvider.isSaas,
      egress: {
        blockLocal: config.infrastructure.modelProvider.blockLocalHttpCalls,
        allowedHosts: config.infrastructure.modelProvider.allowedProxyHosts,
        verifyTls: true,
      },
      ...(config.infrastructure.execution.nlpServiceUrl
        ? {
            executionProxyBaseUrl: HttpWorkflowNlpRuntimeAdapter.proxyBaseUrl({
              baseUrl: config.infrastructure.execution.nlpServiceUrl,
            }),
          }
        : {}),
      environment: config.infrastructure.modelProvider.environment,
    },
    prompt: { publicBaseUrl },
    workflow: { nlpServiceUrl: config.infrastructure.execution.nlpServiceUrl },

    "stored-object": {
      backend: config.infrastructure.storedObjects.backend,
      localFilesystemRoot: config.infrastructure.storedObjects.localFilesystemRoot,
      s3: config.infrastructure.storedObjects.s3,
      azure: {
        authMode: config.infrastructure.storedObjects.azure.authMode,
        accountName: config.infrastructure.storedObjects.azure.accountName,
        accountKey: config.infrastructure.storedObjects.azure.accountKey,
        container: config.infrastructure.storedObjects.azure.container,
        endpoint: config.infrastructure.storedObjects.azure.endpoint,
        authorityHost: config.infrastructure.storedObjects.azure.authorityHost,
        tokenAudience: config.infrastructure.storedObjects.azure.tokenAudience,
        allowInsecureTokenEndpointForTests:
          config.infrastructure.storedObjects.azure.allowInsecureTokenEndpointForTests,
        identity: config.infrastructure.storedObjects.azure.identity,
      },
      azureSpoolRetentionConfirmed:
        config.infrastructure.storedObjects.azureSpoolRetentionConfirmed,
      routes: Object.fromEntries(config.infrastructure.storedObjects.routes),
    },
    trace: {
      processName: config.serviceName,
      publicBaseUrl,
    },

    automation: {
      baseHost: publicBaseUrl,
      unsubscribeSecret: config.storedSecretEncryptionKey,
    },
    log: {},
    "platform-health": config.platformHealth,
    scim: config.scim,
    sso: {
      isSaas: config.infrastructure.modelProvider.isSaas,
      provider: "none",
      baseUrl: config.browserSession?.baseUrl ?? publicBaseUrl ?? "http://localhost",
    },
    licensing: config.infrastructure.licensing,
  };
  return {
    agent: parseModuleConfig(
      serverModules.find((module) => module.name === "agent"),
      slices["agent"],
    ),
    analytics: parseModuleConfig(
      serverModules.find((module) => module.name === "analytics"),
      slices["analytics"],
    ),
    auth: parseModuleConfig(
      serverModules.find((module) => module.name === "auth"),
      slices["auth"],
    ),
    "api-key": parseModuleConfig(
      serverModules.find((module) => module.name === "api-key"),
      slices["api-key"],
    ),
    dashboard: parseModuleConfig(
      serverModules.find((module) => module.name === "dashboard"),
      slices["dashboard"],
    ),
    "data-retention": parseModuleConfig(
      serverModules.find((module) => module.name === "data-retention"),
      slices["data-retention"],
    ),
    "feature-flag": parseModuleConfig(
      serverModules.find((module) => module.name === "feature-flag"),
      slices["feature-flag"],
    ),
    gateway: parseModuleConfig(
      serverModules.find((module) => module.name === "gateway"),
      slices["gateway"],
    ),
    "managed-provider": parseModuleConfig(
      serverModules.find((module) => module.name === "managed-provider"),
      slices["managed-provider"],
    ),
    user: parseModuleConfig(
      serverModules.find((module) => module.name === "user"),
      slices["user"],
    ),
    entitlement: parseModuleConfig(
      serverModules.find((module) => module.name === "entitlement"),
      slices["entitlement"],
    ),
    suite: parseModuleConfig(
      serverModules.find((module) => module.name === "suite"),
      slices["suite"],
    ),
    dataset: parseModuleConfig(
      serverModules.find((module) => module.name === "dataset"),
      slices["dataset"],
    ),
    evaluator: parseModuleConfig(
      serverModules.find((module) => module.name === "evaluator"),
      slices["evaluator"],
    ),
    scenario: parseModuleConfig(
      serverModules.find((module) => module.name === "scenario"),
      slices["scenario"],
    ),
    github: parseModuleConfig(
      serverModules.find((module) => module.name === "github"),
      slices["github"],
    ),
    "hosted-mcp": parseModuleConfig(
      serverModules.find((module) => module.name === "hosted-mcp"),
      slices["hosted-mcp"],
    ),
    identity: parseModuleConfig(
      serverModules.find((module) => module.name === "identity"),
      slices["identity"],
    ),
    organization: parseModuleConfig(
      serverModules.find((module) => module.name === "organization"),
      slices["organization"],
    ),
    ops: parseModuleConfig(
      serverModules.find((module) => module.name === "ops"),
      slices["ops"],
    ),
    langy: parseModuleConfig(
      serverModules.find((module) => module.name === "langy"),
      slices["langy"],
    ),
    "model-provider": parseModuleConfig(
      serverModules.find((module) => module.name === "model-provider"),
      slices["model-provider"],
    ),
    prompt: parseModuleConfig(
      serverModules.find((module) => module.name === "prompt"),
      slices["prompt"],
    ),
    workflow: parseModuleConfig(
      serverModules.find((module) => module.name === "workflow"),
      slices["workflow"],
    ),
    "stored-object": parseModuleConfig(
      serverModules.find((module) => module.name === "stored-object"),
      slices["stored-object"],
    ),
    trace: parseModuleConfig(
      serverModules.find((module) => module.name === "trace"),
      slices["trace"],
    ),
    automation: parseModuleConfig(
      serverModules.find((module) => module.name === "automation"),
      slices["automation"],
    ),
    log: parseModuleConfig(
      serverModules.find((module) => module.name === "log"),
      slices["log"],
    ),
    "platform-health": parseModuleConfig(
      serverModules.find((module) => module.name === "platform-health"),
      slices["platform-health"],
    ),
    scim: parseModuleConfig(
      serverModules.find((module) => module.name === "scim"),
      slices["scim"],
    ),
    sso: parseModuleConfig(
      serverModules.find((module) => module.name === "sso"),
      slices["sso"],
    ),
    licensing: parseModuleConfig(
      serverModules.find((module) => module.name === "licensing"),
      slices["licensing"],
    ),
  };
}

export function apiProcessConfig(options: {
  readonly config: ApiConfig;
  readonly secrets: Readonly<Record<string, unknown>>;
}): ProcessConfig {
  const { config, secrets } = options;
  const infrastructure = config.infrastructure;
  const clickhouse = infrastructure.clickhouse;
  const s3 = infrastructure.storedObjects.s3;

  return {
    processName: config.serviceName,
    encryptionKey: config.storedSecretEncryptionKey ?? "",
    secrets: z
      .record(z.string(), z.string())
      .parse(Object.fromEntries(Object.entries(secrets).filter((entry) => entry[1] !== void 0))),
    rateLimit: DEFAULT_RATE_ALLOWANCE,
    ...(infrastructure.database.url ? { database: { url: infrastructure.database.url } } : {}),
    ...(clickhouse.url || clickhouse.privateRoutes.length > 0
      ? {
          clickhouse: {
            ...(clickhouse.url ? { url: clickhouse.url } : {}),
            privateRoutes: clickhouse.privateRoutes.map((route) => ({
              organizationId: route.organizationId,
              url: route.url,
            })),
          },
        }
      : {}),
    ...redisSlice(infrastructure.redis),
    ...eventingSlice(config),
    ...objectStorageSlice(s3),
    mail: mailSlice(config),
  };
}

/**
 * The api produces and drains nothing: it sends onto the same Group Queue the
 * worker claims, and its store refuses a read by name. No Redis is no queue,
 * so the member refuses rather than dispatching into nowhere.
 */
function eventingSlice(config: ApiConfig): Pick<ProcessConfig, "eventing"> | Record<string, never> {
  if (!config.infrastructure.redis.configured) return {};
  return { eventing: producerEventing({ executionTarget: "api" }) };
}

function redisSlice(
  redis: ApiConfig["infrastructure"]["redis"],
): Pick<ProcessConfig, "redis"> | Record<string, never> {
  if (!redis.configured) return {};
  if (redis.mode === "cluster") {
    return {
      redis: {
        clusterEndpoints: redis.endpoints
          .map((endpoint) => `${endpoint.host}:${endpoint.port}`)
          .join(","),
      },
    };
  }
  return { redis: { url: redis.url, dbIndex: redis.db } };
}

function mailSlice(config: ApiConfig): MailConfig {
  const mail = config.mail;
  if (!mail) return { provider: "off" };
  const mailer = mail.mailer;
  const defaultFrom = mailer.defaultFrom;
  if (mailer.resend.apiKey) {
    return { provider: "resend", defaultFrom, apiKey: mailer.resend.apiKey };
  }
  if (mailer.ses.enabled && mailer.ses.region) {
    return {
      provider: "ses",
      defaultFrom,
      region: mailer.ses.region,
      ...(mailer.ses.endpoint ? { endpoint: mailer.ses.endpoint } : {}),
    };
  }
  if (mailer.smtp.host && mailer.smtp.user && mailer.smtp.password) {
    return {
      provider: "smtp",
      defaultFrom,
      host: mailer.smtp.host,
      port: Number(mailer.smtp.port ?? 587),
      user: mailer.smtp.user,
      password: mailer.smtp.password,
      ...(mailer.smtp.secure === "true" ? { secure: true } : {}),
    };
  }
  return { provider: "off" };
}

function parseModuleConfig<Value>(
  module:
    | { readonly name: string; readonly configSchema?: { parse(value: unknown): Value } }
    | undefined,
  value: unknown,
): Value {
  if (!module?.configSchema) throw new Error("The installed module must declare a config schema.");
  return module.configSchema.parse(value);
}

function objectStorageSlice(
  s3: ApiConfig["infrastructure"]["storedObjects"]["s3"],
): Pick<ProcessConfig, "objectStorage"> {
  return s3.bucket
    ? {
        objectStorage: {
          bucket: s3.bucket,
          ...(s3.region ? { region: s3.region } : {}),
          ...(s3.endpoint ? { endpoint: s3.endpoint, forcePathStyle: true } : {}),
          ...(s3.accessKeyId && s3.secretAccessKey
            ? {
                credentials: {
                  accessKeyId: s3.accessKeyId,
                  secretAccessKey: s3.secretAccessKey,
                  ...(s3.sessionToken ? { sessionToken: s3.sessionToken } : {}),
                },
              }
            : {}),
        },
      }
    : {};
}
