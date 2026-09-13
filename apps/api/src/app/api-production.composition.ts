/**
 * What the interactive process IS: the api role, the config it parsed, and the
 * modules this build installs.
 *
 * There is no wiring left here. Every family the api serves is an installed
 * module that declares its own repositories, its own transports and the
 * members it reads; boot builds exactly that union, in order, and refuses by
 * module and member when this deployment configured none. What used to be
 * 4,989 lines of hand-composition is the module list and the mapping from the
 * api's own parsed config onto the members every process states the same way.
 */
import {
  createProcess,
  type MailConfig,
  type MemberName,
  type ProcessConfig,
  type ProcessMembers,
} from "@langwatch/infrastructure";
import type { MountableRestApp } from "@langwatch/api/rest";
import { auditLogNullServer } from "@langwatch/audit-log-null";
import { serverModules } from "@langwatch/installed-modules/server";
import { ResourceScope, type BootedRuntime } from "@langwatch/runtime-composition";
import { apiRestHosts, type ApiRestBrowserCaller } from "../app-rest/api-rest.host.ts";
import type { ApiConfig } from "../platform/config/api.config.ts";
import { ApiEventingInfrastructure } from "../platform/infrastructure/api-eventing.members.ts";
import { ApiQueueInfrastructure } from "../platform/infrastructure/api-queue.members.ts";

/**
 * The null audit log, installed where no tier provides a real one.
 *
 * `modules/audit-log` publishes a contract and no core server half — the
 * implementation is `enterprise/modules/audit-log/server` — so a core build
 * installs nothing for the `audit-log` token. Meanwhile `agent`, `evaluator`
 * and `ops` each declare a REQUIRED dependency on it, and boot refuses with
 * `MissingProviderError` before the listener opens: the api process cannot
 * start at all in the tier it ships by default.
 *
 * `@langwatch/audit-log-null` is what an installation without the Enterprise
 * feature answers with, and apps/api has always declared the dependency on it
 * in its package.json — only the line that installs it was missing. Appended
 * conditionally so an enterprise build, where the real module IS in the list,
 * does not end up with two providers for one token.
 */
const coreAuditLog = serverModules.some((module) => (module.name as string) === "audit-log")
  ? []
  : [auditLogNullServer];

/**
 * What each installed module parses as its own configuration.
 *
 * `createProcess` takes this as `moduleConfig` and boot hands each module
 * `config[<module name>]`, which its `configSchema` then parses. **No process
 * was passing it.** The option existed, nothing supplied it, so every module
 * declaring a schema received `undefined` and refused at boot with
 * `FeatureConfigError` — the api could not start for the same reason it could
 * not start on the three unsatisfiable member claims: a seam that was built
 * and never connected.
 *
 * Every installed module that declares a schema needs an entry, because a
 * schema parses `{}` into its defaults but refuses `undefined`. The values are
 * the ones the api already parses for itself — this maps them onto the names
 * the modules declare, it does not re-read the environment. `automation` and
 * `log` get an empty object on purpose: their schemas are wholly defaulted and
 * the api parses nothing for them, so anything else would be inventing
 * configuration rather than passing it on.
 */
/**
 * One config slice with its empty strings dropped.
 *
 * A resolution that writes `""` for "the operator set nothing" is saying
 * absent in a value that is present, and a module declaring
 * `Config.optionalSecret` — `z.string().min(1).optional()` — refuses it,
 * because the `optional()` branch is unreachable for an empty string. The api
 * resolves github's four credentials that way (`appId?.trim() ?? ""`) while
 * resolving `host` beside them as `|| undefined`, so the inconsistency is
 * inside one object literal.
 *
 * Filtered here rather than at the resolution, because
 * `ApiGithubConfigResolution` types those four as `string` and other readers
 * are entitled to that. What crosses into a module is the module's own
 * statement of absence.
 */
function stated<Slice extends Record<string, unknown>>(slice: Slice): Partial<Slice> {
  return Object.fromEntries(
    Object.entries(slice).filter(([, value]) => value !== ""),
  ) as Partial<Slice>;
}

function apiModuleConfig(config: ApiConfig): Readonly<Record<string, unknown>> {
  return {
    agent: {
      publicBaseUrl: config.infrastructure.execution.publicBaseUrl,
      connected: config.infrastructure.connectedAgents,
    },
    /**
     * The resolution carries all five fields or is absent entirely ("absent
     * means unprovisioned"), while the module declares the same five each
     * optional — so an unprovisioned deployment passes an empty object, not
     * a missing one, and analytics reads every field as unset.
     */
    analytics: { langwatchQl: config.infrastructure.clickhouse.langwatchQl ?? {} },
    "api-key": { pepper: config.apiKeyPepper },
    "data-retention": {
      platformDefaultRetentionDays: config.platformDefaultRetentionDays,
    },
    github: stated(config.infrastructure.github),
    /** The origin a hosted MCP server advertises is the api's public one. */
    "hosted-mcp": { baseHost: config.infrastructure.execution.publicBaseUrl },
    /** `ADMIN_EMAILS`, for the SSO platform-operator check (D05 tier 1). */
    identity: {
      adminEmails: (config.deployment.adminEmails ?? "")
        .split(",")
        .map((email) => email.trim())
        .filter((email) => email.length > 0),
    },
    /** The api keeps only the shared secret from its langy block; the rest defaults. */
    langy: { internalSecret: config.langyInternalSecret },
    automation: {},
    log: {},
    "platform-health": config.platformHealth,
  };
}

/** The api process's own rate allowance, until a deployment states one. */
const DEFAULT_RATE_ALLOWANCE = { requests: 60, seconds: 60 } as const;

/**
 * The api's parsed config, as every process states itself.
 *
 * A datastore this deployment did not name is left out rather than defaulted:
 * an absent address is never a decision to run without the store, so the
 * member refuses by name at boot and the module that reads it is named with
 * it. The only way to run a module without its stores is to install it on its
 * memory repositories, in code.
 */
export function apiProcessConfig(options: {
  readonly config: ApiConfig;
  /** Every secret this process resolved at boot (ADR-132). */
  readonly secrets: Readonly<Record<string, string>>;
}): ProcessConfig {
  const { config, secrets } = options;
  const infrastructure = config.infrastructure;
  const clickhouse = infrastructure.clickhouse;
  const s3 = infrastructure.storedObjects.s3;

  return {
    processName: config.serviceName,
    encryptionKey: config.storedSecretEncryptionKey ?? "",
    secrets,
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
    ...(s3.bucket
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
      : {}),
    mail: mailSlice(config),
  };
}

/** Redis, in whichever of its two shapes this deployment named. */
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

/**
 * Which gateway this deployment sends through.
 *
 * `off` is a statement, so a deployment that named no gateway reaches the mail
 * member as a refusal by name rather than as messages dropped quietly.
 */
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

/** What a caller may hand this process instead of letting it build one. */
export type ApiProcessMemberOverrides = {
  readonly [Name in MemberName]?: ProcessMembers[Name];
};

/**
 * The api process, booted.
 *
 * Nothing is constructed until `boot`, and boot builds exactly the union the
 * installed modules declared: a client no module reads is never opened.
 */
export function bootApiProcess(options: {
  readonly config: ApiConfig;
  readonly secrets: Readonly<Record<string, string>>;
  readonly members?: ApiProcessMemberOverrides;
  /** What a browser cookie resolved, where this deployment composed a verifier. */
  readonly browserSession?:
    | ((request: Request) => Promise<ApiRestBrowserCaller | null>)
    | undefined;
}): Promise<BootedRuntime<ProcessMembers, MountableRestApp, never>> {
  const config = options.config;

  // The api's `eventing` member: a producer, and only ever a producer (the
  // three structural decisions are api-eventing.members.ts's docblock). Built
  // here rather than from the config slice because which log a role appends
  // to and whether it claims the queue are role decisions, and this role's
  // answer is objects, not addresses: a producer-only store and a factory
  // over the process's one Group Queue. No Redis means no queue and no
  // eventing member, and a module reading it then refuses by name at boot —
  // the honest answer for a process that cannot enqueue. `createProcess`
  // never closes a member the caller built, so the runtime service below
  // drains the producer and its connection after the feature graph stops.
  const producerResources = new ResourceScope();
  const queue = ApiQueueInfrastructure.tryCreate({
    resources: producerResources,
    redis: config.infrastructure.redis,
  });
  const eventing = ApiEventingInfrastructure.tryCreate({
    resources: producerResources,
    queue,
    processName: config.serviceName,
  });

  return createProcess({
    role: "api",
    config: apiProcessConfig({ config, secrets: options.secrets }),
    moduleConfig: apiModuleConfig(config),
    members: {
      ...(eventing ? { eventing: eventing.eventSourcing } : {}),
      ...options.members,
    },
  })
    .withModules(serverModules)
    .withModules(coreAuditLog)
    .withService({
      name: "api eventing producer",
      start: () => void 0,
      stop: () => producerResources.close(),
    })
    .withTransports(
      apiRestHosts({
        config: {
          // Which secret guards which internal family. One door, several
          // secrets: a cron bearer must not reach the agent manager.
          internalSecrets: {
            cron: config.cronApiKey,
            "langy-internal": config.langyInternalSecret,
          },
          instanceAdminKey: config.instanceAdminApiKey,
          ...(options.browserSession ? { browserSession: options.browserSession } : {}),
        },
      }),
    )
    .boot();
}
