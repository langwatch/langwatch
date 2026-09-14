// What the interactive process IS: config, role, and installed modules.
// Boot unions every module's repositories and transports.
import {
  createProcessMembers,
  type MailConfig,
  type MemberName,
  type ProcessConfig,
  type ProcessMemberSource,
  type ProcessMembers,
} from "@langwatch/infrastructure";
import { IdempotencyLedger, type IdempotentRunner } from "@langwatch/api/rest";
import type { MountableRestApp } from "@langwatch/api/rest";
import { auditLogNullServer } from "@langwatch/audit-log-null";
import { createLogger } from "@langwatch/observability";
import { serverModules } from "@langwatch/installed-modules/server";
import {
  createApp,
  ResourceScope,
  type BootedRuntime,
  type TransportPeers,
} from "@langwatch/runtime-composition";
import { HttpWorkflowNlpRuntimeAdapter } from "@langwatch/workflow-server";
import type { ApiPreRoutingSurface } from "../api-http.listener.ts";
import { ApiRestHost, type ApiRestBrowserCaller } from "../app-rest/api-rest.host.ts";
import {
  mountedPathsOfRestFamilies,
  tryCreateApiStaticSurface,
} from "../app-static/app-static.surface.ts";
import { AuthApi } from "@langwatch/auth-contract";
import {
  composeApiTrpcSession,
  type ApiBrowserSessionTransport,
} from "./api-auth.composition.ts";
import {
  ApiTrpcHost,
  type ApiTrpcNamespace,
  type ApiTrpcSessionResolver,
} from "../app-trpc/api-trpc.host.ts";
import {
  ABSENT_API_TRPC_NAMESPACES,
  absentNamespaceReason,
} from "../app-trpc/app-trpc.namespaces.ts";
import type { ApiConfig } from "../platform/config/api.config.ts";
import { ApiEventingInfrastructure } from "../platform/infrastructure/api-eventing.members.ts";
import { ApiQueueInfrastructure } from "../platform/infrastructure/api-queue.members.ts";

// Core build needs null audit log where enterprise module not available.
const coreAuditLog = serverModules.some((module) => (module.name as string) === "audit-log")
  ? []
  : [auditLogNullServer];

// Each module gets its config slice from the API's parsed values.
// Drop empty strings from config slices; modules expect absence, not "".
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
    analytics: {
      langwatchQl: config.infrastructure.clickhouse.langwatchQl ?? {},
      publicBaseUrl: config.infrastructure.execution.publicBaseUrl,
    },
    auth: {
      processName: config.serviceName,
      ...(config.browserSession ? { browserSession: config.browserSession } : {}),
      isSaas: config.infrastructure.modelProvider.isSaas,
    },
    "api-key": { pepper: config.apiKeyPepper },
    "data-retention": {
      platformDefaultRetentionDays: config.platformDefaultRetentionDays,
    },
    // Already resolved by API; module receives RESOLVED record.
    "feature-flag": config.featureFlags,
    /** Carried raw: `settlementGraceMs` in the gateway package owns the parse and the bound. */
    gateway: {
      internalSecret: config.gatewayInternalSecret,
      jwtSecret: config.gatewayJwtSecret,
      virtualKeyPepper: config.virtualKeyPepper,
      spendSettlementGraceMs: config.spendSettlementGraceMs,
    },
    /** The passkey offer and the budget deep link answer from the session door's own config. */
    user: {
      passkeysEnabled: config.browserSession?.passkeysEnabled ?? false,
      baseUrl: config.browserSession?.publicBaseUrl ?? null,
    },
    /** Plan resolution's deployment facts: the hosted flag and the process's name in refusals. */
    entitlement: {
      processName: config.serviceName,
      isSaas: config.infrastructure.modelProvider.isSaas,
    },
    /** Suite deep links build under the same public origin. */
    ...(config.infrastructure.execution.publicBaseUrl
      ? { suite: { publicBaseUrl: config.infrastructure.execution.publicBaseUrl } }
      : {}),
    /** The address a dataset deep link is built under: this deployment's public one. */
    ...(config.infrastructure.execution.publicBaseUrl
      ? { dataset: { publicBaseUrl: config.infrastructure.execution.publicBaseUrl } }
      : {}),
    /** Evaluator link addresses build under the same public origin. */
    evaluator: {
      ...(config.infrastructure.execution.publicBaseUrl
        ? { publicBaseUrl: config.infrastructure.execution.publicBaseUrl }
        : {}),
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
    // Process name in refusals and demo organization.
    organization: {
      processName: config.serviceName,
      demoProject: {
        userId: config.authz.demoProjectUserId ?? "",
        projectId: config.authz.demoProjectId ?? "",
      },
    },
    /** The operator surface: same ADMIN_EMAILS list, the EXPLAIN account, prod gate. */
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
      // Verbatim from the deleted ops.composition.ts (ADR-117 §5); not a
      // classified secret, and no parsed config field carries it yet.
      legacySsoStringWritesRetired: process.env.SSOCONN_ROUTING === "enforce",
    },
    /** The api keeps only the shared secret from its langy block; the rest defaults. */
    langy: { internalSecret: config.langyInternalSecret },
    /** The address a prompt's deep link is built under: this deployment's public one. */
    prompt: { publicBaseUrl: config.infrastructure.execution.publicBaseUrl },
    /** Where a Studio graph runs; absent, workflow's runs refuse by name. */
    workflow: { nlpServiceUrl: config.infrastructure.modelProvider.nlpServiceUrl },
    // Blob backends as parsed by API; Map becomes JSON schema shape.
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
    /** The api's own name in trace refusals, and the address media links are built under. */
    trace: {
      processName: config.serviceName,
      publicBaseUrl: config.infrastructure.execution.publicBaseUrl,
    },
    // Public host and unsubscribe signing secret.
    automation: {
      baseHost: config.infrastructure.execution.publicBaseUrl ?? "",
      unsubscribeSecret: config.storedSecretEncryptionKey,
    },
    log: {},
    "platform-health": config.platformHealth,
  };
}

/** The api process's own rate allowance, until a deployment states one. */
const DEFAULT_RATE_ALLOWANCE = { requests: 60, seconds: 60 } as const;

/**
 * The one ledger every create declared replayable keeps its receipts in: a
 * receipt is an encrypted row in this application's database, so a family
 * cannot hold one of its own. A deployment with no database has nowhere to
 * keep one, and a route declaring the behaviour is refused at mount instead.
 */
function apiIdempotencyLedger(options: {
  readonly config: ProcessConfig;
  readonly members: ProcessMemberSource;
}): IdempotentRunner | undefined {
  if (!options.config.database?.url) return undefined;

  return IdempotencyLedger.create({
    receipts: options.members.read("prisma"),
    cipher: options.members.read("encryption"),
  }).run;
}

// API's parsed config. Absent datastores refuse at boot.
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
export async function bootApiProcess(options: {
  readonly config: ApiConfig;
  readonly secrets: Readonly<Record<string, string>>;
  readonly members?: ApiProcessMemberOverrides;
  /** What a browser cookie resolved, where this deployment composed a verifier. */
  readonly browserSession?:
    | ((request: Request) => Promise<ApiRestBrowserCaller | null>)
    | undefined;
  /**
   * The deployment's Better Auth request boundary, where it composed one. Boot
   * joins it to the auth module's own live-session lookup, so a host supplies
   * the one half no module can answer rather than the whole resolver.
   */
  readonly browserSessions?: ApiBrowserSessionTransport | undefined;
  /**
   * The same cookie, resolved to the whole signed-in person, for the tRPC door.
   * A narrower answer than REST's on purpose: a procedure renders the person,
   * a byte route only needs to know there is one.
   */
  readonly trpcSession?: ApiTrpcSessionResolver | undefined;
}): Promise<ApiBootedProcess> {
  const config = options.config;

  // Eventing producer member. No Redis means no queue, module refuses at boot.
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

  // Held from the doors factory: the tRPC host is the one object that can
  // compose what boot mounted on it, and boot builds it because only boot
  // holds the peers its authorization port reads.
  let trpc: ApiTrpcHost | undefined;

  // The members are built here rather than inside `createProcess` because the
  // REST door needs two of them - the client a receipt row is written to and
  // the cipher it is written under - before a single family is mounted. Read
  // through the one source either way, so the process still opens exactly one
  // client per member.
  const processConfig = apiProcessConfig({ config, secrets: options.secrets });
  const members = createProcessMembers({
    config: processConfig,
    members: {
      ...(eventing ? { eventing: eventing.eventSourcing } : {}),
      ...options.members,
    },
  });

  const idempotency = apiIdempotencyLedger({ config: processConfig, members });

  const nlpServiceUrl = config.infrastructure.execution.nlpServiceUrl;
  const executionProxyBaseUrl = nlpServiceUrl
    ? HttpWorkflowNlpRuntimeAdapter.proxyBaseUrl({ baseUrl: nlpServiceUrl })
    : undefined;

  const runtime = await createApp<ProcessMembers>({
    role: "api",
    config: apiModuleConfig(config),
    members,
  })
    .withModules(serverModules)
    .withModules(coreAuditLog)
    .withService({
      name: "api eventing producer",
      start: () => void 0,
      stop: () => producerResources.close(),
    })
    .withTransports((peers: TransportPeers) => {
      // The same auth peer the REST host reaches for: unless the launcher
      // handed this process a resolver, the tRPC door reads sessions through
      // the auth module too, so the two doors cannot decide differently about
      // who somebody is. Left absent, the door stays mounted and refuses every
      // signed-in caller as anonymous — which the browser shell reads as
      // "signed out" and answers with a redirect loop through the sign-in page.
      const auth = peers.find(AuthApi);
      const trpcSession =
        options.trpcSession ?? (auth ? composeApiTrpcSession({ auth }) : undefined);

      return {
        rest: ApiRestHost.create({
          peers,
          config: {
            // Which secret guards which internal family. One door, several
            // secrets: a cron bearer must not reach the agent manager.
            internalSecrets: {
              cron: config.cronApiKey,
              "langy-internal": config.langyInternalSecret,
            },
            instanceAdminKey: config.instanceAdminApiKey,
            ...(idempotency ? { idempotency } : {}),
            ...(options.browserSession ? { browserSession: options.browserSession } : {}),
            ...(options.browserSessions ? { browserSessions: options.browserSessions } : {}),
            // The engine's address plus the proxy path, joined here because the
            // path is the WORKFLOW module's and the address is the deployment's.
            ...(executionProxyBaseUrl ? { executionProxyBaseUrl } : {}),
          },
        }),
        trpc: (trpc = ApiTrpcHost.create({
          peers,
          config: {
            ...(trpcSession ? { browserSession: trpcSession } : {}),
          },
        })),
      };
    })
    .boot();

  if (!trpc) {
    throw new Error("The api process booted without opening its tRPC door.");
  }
  reportAbsentTrpcNamespaces(runtime.transports.trpc);

  // The built browser bundle, served by this process off the same listener.
  // `apps/ui` is a build, not a deployable: the image ships its `dist/client`
  // beside this app (infra/docker/Dockerfile:217,240) and the chart runs one
  // interactive Deployment (charts/langwatch/templates/app/deployment.yaml), so
  // the pod that answers `/api/*` is the pod a browser asks for `/`. Asked LAST,
  // after every address the mounted families declare, because it is the
  // fallback — and the families' own route table is what it defers to, so a
  // root-level address like the hosted MCP endpoint's `/mcp` stays theirs.
  const staticSurface = tryCreateApiStaticSurface({
    environment: globalThis.process.env,
    report: (message, context) => createLogger(config.serviceName).info(context, message),
    mountedPaths: mountedPathsOfRestFamilies(runtime.transports.rest),
  });

  return { runtime, trpc, ...(staticSurface ? { staticSurface } : {}) };
}

/**
 * What the api process booted into: everything boot constructed, plus the one
 * door that can turn the namespaces it mounted into a served router.
 */
export type ApiBootedProcess = Readonly<{
  runtime: BootedRuntime<ProcessMembers, MountableRestApp, ApiTrpcNamespace>;
  trpc: ApiTrpcHost;
  /**
   * The built browser bundle, served straight off the Node server ahead of the
   * Hono application. Absent when this build carries no `apps/ui/dist/client` —
   * a source checkout that never ran the browser build, which then answers `/`
   * from the Hono application alone exactly as it did before.
   */
  staticSurface?: ApiPreRoutingSurface;
}>;

/**
 * Names each namespace this build does not serve, once, at boot.
 *
 * The list is a conversion queue, not a failure: a namespace leaves it the
 * moment its module declares its transport. What WOULD be a failure is a
 * namespace that is neither mounted nor listed, so an entry the process turned
 * out to serve is reported too — a stale line hides a converted module.
 */
function reportAbsentTrpcNamespaces(mounted: Readonly<Record<string, unknown>>): void {
  const logger = createLogger("langwatch:api:trpc");
  for (const entry of ABSENT_API_TRPC_NAMESPACES) {
    if (Object.hasOwn(mounted, entry.namespace)) {
      logger.warn(
        { namespace: entry.namespace, module: entry.module },
        "This namespace is served and still listed absent; drop its entry from ABSENT_API_TRPC_NAMESPACES",
      );
      continue;
    }
    logger.warn({ namespace: entry.namespace }, absentNamespaceReason(entry));
  }
}
