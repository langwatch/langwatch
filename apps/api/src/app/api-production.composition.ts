import type { AgentService } from "@langwatch/agent-contract";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { GroupQueueStoragePort } from "@langwatch/group-queue";
import { createLogger, type Logger } from "@langwatch/observability";
import {
  createProcessObservability,
  type ProcessObservability,
} from "@langwatch/observability/node";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { SecretService } from "@langwatch/secret-contract";
import { createApiKeysRestApp } from "@langwatch/api-key-server";
import { PostgresSecretAdapter, type SecretEncryptionPort } from "@langwatch/secret-server";
import { RESERVED_PROJECT_SECRET_NAMES } from "@langwatch/secret-contract";
import { Hono } from "hono";
import { register } from "prom-client";
import {
  ApiAuditPort,
  ApiRequestPolicy,
  AuthzApiAuthorizationAdapter,
} from "../api-request.policy";
import {
  ApiFeatureDrainPort,
  ApiProcess,
  ApiProcessGraphPort,
  closeApiProcessResources,
} from "../api.process";
import { ApiHttpListener } from "../api-http.listener";
import {
  ApiMetricsPort,
  ApiProcessLifecycleRoutes,
  ApiReadinessPort,
} from "../api-process.lifecycle";
import {
  ApiDatabaseAbsenceReportPort,
  ApiDatabaseInfrastructure,
} from "../platform/infrastructure/api-database.infrastructure";
import {
  ApiQueueAbsenceReportPort,
  ApiQueueInfrastructure,
} from "../platform/infrastructure/api-queue.infrastructure";
import {
  ApiEventingAbsenceReportPort,
  ApiEventingInfrastructure,
} from "../platform/infrastructure/api-eventing.infrastructure";
import {
  ApiClickHouseAbsenceReportPort,
  ApiClickHouseInfrastructure,
} from "../platform/infrastructure/api-clickhouse.infrastructure";
import { ApiAgentsAbsenceReportPort, ApiAgentsComposition } from "./api-agents.composition";
import {
  composeApiAnalyticsCollaborators,
  withApiAnalyticsCollaborators,
  type ApiAnalyticsCollaborators,
} from "./api-trpc-collaborators.analytics.composition";
import {
  ApiTrpcFeaturesComposition,
  LoggedApiTrpcFeaturesAbsence,
} from "./api-trpc-features.composition";
import type { AnyApiTrpcCollaborators } from "../app-trpc/app-trpc.collaborators";
import { ApiAuthzAbsenceReportPort, ApiAuthzComposition } from "./api-authz.composition";
import { ApiTenancyAbsenceReportPort, ApiTenancyComposition } from "./api-tenancy.composition";
import {
  ApiMetricsAbsenceReportPort,
  ApiMetricsInfrastructure,
} from "../platform/infrastructure/api-metrics.infrastructure";
import {
  ApiSecretEncryptionAbsenceReportPort,
  ApiSecretEncryptionInfrastructure,
} from "../platform/infrastructure/api-secret-encryption.infrastructure";
import {
  ApiRuntimeCompositionPort,
  ApiRuntimeProcessPort,
  type ApiRuntimeCompositionOptions,
} from "../api.main";
import { ApiSecretRestFeature } from "../api-secret-rest.feature";
import { ApiRestSecurity, type ApiRestProjectPolicy } from "../api-rest.security";
import type { AppRestManagementAuditPort, AppRestSecurity } from "@langwatch/api/rest";
import type { AppRestFeaturePorts } from "../app-rest/app-rest.features";
import { ApiRateLimitInfrastructure } from "../platform/infrastructure/api-rate-limit.infrastructure";
import {
  ApiAuthAbsenceReportPort,
  ApiAuthComposition,
  ApiAuthSessionCompositionPort,
  ApiBrowserSessionTransportPort,
  AuthSessionApiAuthenticationAdapter,
} from "./api-auth.composition";
import { ApiInstanceAdminKeyAdapter } from "./api-instance-admin-key.adapter";
import { ApiRestObservabilityComposition } from "./api-rest-observability.composition";
import type { ApiSubscriptionMount } from "../api.application";
import { createSseSubscriptionApp } from "../app-trpc/app-trpc.sse";

/**
 * The `AppRestFeaturePorts` entries the API process supplies out of its own
 * configuration and its own infrastructure, rather than receiving from a host.
 *
 * Two today: the instance administrator credential, which is a value in the
 * process's validated config, and the public REST rate limiter, which is a
 * counter over the process's own Redis. Neither needed anything from the
 * legacy application to begin with — they were only there because that is
 * where the environment and the Redis client used to live.
 */
export type ApiOwnedRestFeaturePorts = Pick<AppRestFeaturePorts, "instanceAdminKey" | "rateLimit">;

/**
 * What a host hands the production composition, and what it may leave out.
 *
 * One flat object, and every field on it is optional. A host supplies a field
 * to OVERRIDE what this process would compose for itself — a test binding a
 * double, or a deployment that already owns one instance of the service graph
 * — rather than to unlock a graph that would not exist without it. Leaving any
 * of them out is a supported shape with the consequence each one names, and
 * one of them is not a service at all: `browserSessions` is the deployment's
 * own Better Auth instance, the last collaborator on this list no package
 * implements.
 */
export type ApiProductionCompositionOptions = {
  /**
   * A host's already-composed agent service, when it has one.
   *
   * Optional since this process can build its own over its guarded client, with
   * the one gap that composition names: it holds no Workflow application, so
   * copying a workflow agent refuses rather than writing an agent pointing at
   * another project's graph. See
   * {@link ApiProductionComposition.resolveAgents} for which wins and what an
   * unresolvable agent service means for the door that serves it.
   */
  agents?: AgentService;
  /**
   * A host's already-composed secret service, when it has one.
   *
   * Optional since this process can build its own: see
   * {@link ApiProductionComposition.resolveSecrets} for which wins.
   */
  secrets?: SecretService;
  /**
   * A host's already-composed API-key service, when it has one.
   *
   * Optional since this process can build its own, but only as a PAIR with the
   * organization service: see {@link ApiProductionComposition.resolveTenancy}
   * for why supplying one without the other is refused.
   */
  apiKeys?: ApiKeyService;
  /**
   * A host's already-composed AuthZ service, when it has one.
   *
   * Optional since this process can build its own: see
   * {@link ApiProductionComposition.resolveAuthz} for which wins and what an
   * unresolvable AuthZ means for the doors that authorize through it.
   */
  authz?: AuthzService;
  /** A host's already-composed organization service; the pair to `apiKeys`. */
  organizations?: OrganizationService;
  /**
   * A host's already-composed Auth service and Better Auth transport, when it
   * has them as a pair.
   *
   * Optional since this process can build the Auth half itself: see
   * {@link ApiProductionComposition.resolveAuth} for which wins and what
   * neither means for the doors that authenticate a browser caller.
   */
  auth?: ApiAuthSessionCompositionPort;
  /**
   * The deployment's Better Auth request boundary, for a host that supplies
   * only that.
   *
   * This is the collaborator the API package cannot build — see
   * {@link ApiAuthComposition} — and the one entry on
   * `API_UNAVAILABLE_PRODUCT_ADAPTERS`. Without it, and without `auth`, this
   * process can authenticate no browser caller and mounts no product
   * transports at all. Ignored when `auth` is supplied, because that pair
   * already carries its own transport.
   */
  browserSessions?: ApiBrowserSessionTransportPort;
  audit?: ApiAuditPort;
  readiness?: ApiReadinessPort;
  /**
   * A host's already-composed metrics transport, when it has one.
   *
   * Optional since this process can build its own: see
   * {@link resolveApiMetrics} for which wins.
   */
  metrics?: ApiMetricsPort;
  featureDrain?: ApiFeatureDrainPort;
  queueStorage?: GroupQueueStoragePort;
  /**
   * The capabilities the packaged tRPC record reaches that no package owns
   * yet — the analytics filter catalogue, the LangWatchQL workbench, the trace
   * pipeline, the sign-in and sign-up ceremonies, the evaluator runtime, the
   * model gateway and the Enterprise governance surfaces.
   *
   * Optional, and its absence is the reason this process serves no packaged
   * namespaces rather than a reason it fails to boot. See
   * {@link ApiTrpcCollaborators}: with them, all twenty-two mount on the same
   * root the subscription lane resolves paths on; without them, the process
   * serves its agent and secret routers exactly as before and says so once at
   * boot.
   */
  trpcCollaborators?: AnyApiTrpcCollaborators;
};

/** The credential pair every product transport on this process is built from. */
type ApiResolvedTenancy = Readonly<{
  apiKeys: ApiKeyService;
  organizations: OrganizationService;
}>;

/** The concrete composition port for the migrated API transports. */
export class ApiProductionComposition extends ApiRuntimeCompositionPort {
  static create(options: ApiProductionCompositionOptions): ApiProductionComposition {
    // Checked here rather than at compose, because it is a fact about the
    // options and not about the deployment: it can be answered before a socket
    // is opened, and answering it later would open resources for a graph that
    // was never going to be composed.
    if (Boolean(options.apiKeys) !== Boolean(options.organizations)) {
      throw new Error(
        "API composition received one of the API-key and organization services without the other: they are one graph and must be supplied together, or neither.",
      );
    }
    return new ApiProductionComposition(options);
  }

  private composedFeaturePorts: ApiOwnedRestFeaturePorts | undefined;
  private composedDatabase: ApiDatabaseInfrastructure | undefined;
  private composedEventing: ApiEventingInfrastructure | undefined;
  private composedAuthz: ApiAuthzComposition | undefined;
  private composedTenancy: ApiTenancyComposition | undefined;
  private composedAgents: ApiAgentsComposition | undefined;
  private composedAuth: ApiAuthComposition | undefined;
  private composedClickHouse: ApiClickHouseInfrastructure | undefined;
  private composedAnalytics: ApiAnalyticsCollaborators | undefined;
  private secrets: SecretService | undefined;
  private requestPolicy: ApiRequestPolicy | undefined;

  private constructor(private readonly options: ApiProductionCompositionOptions) {
    super();
  }

  /**
   * Composes the process, in the one order its parts allow.
   *
   * Infrastructure first, because every product service below is built from
   * it; then AuthZ, because both doors authorize through it and neither can be
   * built before it exists; then the transports.
   *
   * With no AuthZ, no organization and API-key pair, or no way to authenticate
   * a browser caller, the process serves its lifecycle surface and no product
   * transports at all. That is the same rule the secret family follows one
   * level down — a door that cannot answer is absent rather than mounted — and
   * it is the only safe reading at this level: every product route on this
   * process is authorized, every one of them resolves a credential, and the
   * ones a person reaches resolve a session, so a route graph mounted over any
   * of those gaps would be a route graph that cannot say no. The session gap is
   * the sharpest of the three, because its degradation is silent: a policy
   * built over a transport that verifies nothing does not fail, it answers
   * "signed out" to everybody.
   */
  compose(options: ApiRuntimeCompositionOptions): Promise<ApiRuntimeProcessPort> {
    const queueInfrastructure = this.composeQueue(options);
    this.composedDatabase = composeApiDatabase(options);
    this.composedEventing = this.composeEventing(options, queueInfrastructure);
    const authz = this.resolveAuthz(options, queueInfrastructure);
    const readiness = this.options.readiness ?? queueInfrastructure?.readiness;
    const metrics = resolveApiMetrics({ options, injected: this.options.metrics });
    const encryption = composeApiSecretEncryption(options)?.encryption;
    const tenancy = authz ? this.resolveTenancy(options, encryption) : undefined;
    const auth = tenancy ? this.resolveAuth(options, tenancy, queueInfrastructure) : undefined;

    if (!authz || !tenancy || !auth) {
      return Promise.resolve(
        composeApiLifecycleProcess({
          options,
          metrics,
          readiness,
          featureDrain: this.options.featureDrain,
        }),
      );
    }

    this.secrets = this.resolveSecrets(encryption);
    this.composedFeaturePorts = this.composeFeaturePorts(options, queueInfrastructure);
    this.requestPolicy = ApiRequestPolicy.create({
      authentication: AuthSessionApiAuthenticationAdapter.create(auth.compose()),
      authorization: AuthzApiAuthorizationAdapter.create(authz),
      audit: this.options.audit,
    });
    const agents = this.resolveAgents(options);
    // The charted reads, the workbench and the dashboards, composed over this
    // process's OWN ClickHouse and the second, restricted identity a member's
    // submitted SQL runs as. Both are this composition's to open, so the record
    // below can be satisfied without a host handing them in.
    this.composedAnalytics = this.composeAnalytics(options, authz);
    const features = ApiTrpcFeaturesComposition.tryCompose({
      database: this.composedDatabase?.connection,
      // The SAME AuthZ service the REST doors authorize through: a permission
      // probe inside a resolver must answer what the declared check on the
      // same procedure would have.
      authz,
      audit: this.options.audit,
      collaborators: withApiAnalyticsCollaborators(
        this.options.trpcCollaborators,
        this.composedAnalytics,
      ),
      report: LoggedApiTrpcFeaturesAbsence.create(createLogger(options.config.serviceName)),
    });
    const process = ApiProcess.create({
      agents,
      ...(features ? { features } : {}),
      secrets: this.secrets,
      requestPolicy: this.requestPolicy,
      ...this.composeDoors(authz, tenancy),
      observability: options.observability,
      graph: options.graph,
      featureDrain: this.options.featureDrain,
      readiness,
      metrics,
      listener: {
        host: options.config.host,
        port: options.config.port,
        drainGraceMs: options.config.httpDrainGraceMs,
      },
    });

    return Promise.resolve(ApiProductionProcess.create(process));
  }

  /**
   * The request policy this process enforces with, once it has been composed.
   *
   * `undefined` before `compose`, and after a `compose` that resolved no AuthZ
   * — a policy whose authorization port is missing is not a weaker policy, it
   * is one that cannot refuse, so there is no object to hand back.
   */
  policy(): ApiRequestPolicy | undefined {
    return this.requestPolicy;
  }

  /**
   * The two AuthZ contract services this process serves, once composed.
   *
   * Exposed as a pair because they are one graph: the grants service writes
   * through the ledger whose commands the permission service's reads converge
   * on, and a caller holding one from this process and the other from
   * somewhere else would have two epochs for one organization.
   */
  authz(): { permissions: AuthzService; grants: AuthzGrantsService } | undefined {
    if (this.composedAuthz) {
      return { permissions: this.composedAuthz.permissions, grants: this.composedAuthz.grants };
    }
    return undefined;
  }

  /**
   * The organization, project and API-key services this process composed for
   * itself, once it has.
   *
   * `undefined` when a host supplied the pair instead, and `undefined` before
   * `compose`. Exposed as one object because they are one graph: the API-key
   * service reads the project service, which resolves through the organization
   * service, and three separately-held services could be three graphs.
   */
  tenancy(): ApiTenancyComposition | undefined {
    return this.composedTenancy;
  }

  /**
   * The feature ports this process owns, once it has been composed.
   *
   * `undefined` before `compose`, and deliberately so: the rate limiter counts
   * in the SAME Redis the queue infrastructure composed, and that connection
   * does not exist until the process does. Reading them from the composition
   * rather than binding them again is what keeps one deployment on one
   * counter and one credential.
   *
   * They are exposed rather than mounted because the two families that read
   * them still need services this package cannot construct — the organization
   * provisioning port behind `/api/organizations`, the stored-object
   * application behind `/api/files`. Neither is on
   * `API_UNAVAILABLE_PRODUCT_ADAPTERS`, which names the adapters a HOST must
   * supply; these are ports no package implements yet at all. The host that
   * mounts those families spreads these in instead of binding its own.
   */
  restFeaturePorts(): ApiOwnedRestFeaturePorts | undefined {
    return this.composedFeaturePorts;
  }

  /**
   * The process's one guarded Prisma connection, once it has been composed.
   *
   * `undefined` before `compose`, and `undefined` after it when the deployment
   * configured no `DATABASE_URL` — the same degradation Redis has. Nothing
   * below the composition root constructs a client, so this accessor is the
   * only place a typed `PrismaClient` enters the process.
   *
   * It is exposed as well as consumed. This process now builds the secret,
   * AuthZ, organization, project, API-key and agent services over it, and a
   * host that mounts families this package does not — the organization
   * provisioning door, the stored-object application — composes their packaged
   * adapters over the SAME client rather than opening a second pool with a
   * second guard.
   */
  database(): PrismaConnection | undefined {
    return this.composedDatabase?.connection;
  }

  /**
   * The secret service this process serves, and where it came from.
   *
   * Precedence, and the reason for it:
   *
   *  1. An injected service wins. A host that already owns the product graph
   *     has one composed service per process, and a test that binds a double
   *     is asking for that double rather than for Postgres.
   *  2. Otherwise the process composes its own, over the guarded client
   *     {@link composeApiDatabase} opened and the cipher its configured key
   *     built. This is the first product service the API package builds for
   *     itself rather than receiving. The cipher is composed ONCE by `compose`
   *     and handed here, because the organization service's settings port runs
   *     under the same one — two ciphers over one key is a way for two
   *     descriptions of one at-rest format to drift.
   *  3. With neither — no host service, and no database or no key — there is
   *     no secret service, and the transports that would call one are not
   *     mounted. A door that answered every call with a 500 would be worse
   *     than a door that is not there.
   *
   * The reserved names come from the contract rather than from this root, so
   * a product-owned secret is hidden by this process on the same terms the
   * platform app hides it.
   */
  private resolveSecrets(encryption: SecretEncryptionPort | undefined): SecretService | undefined {
    if (this.options.secrets) return this.options.secrets;

    const database = this.composedDatabase;
    if (!database || !encryption) return undefined;

    return PostgresSecretAdapter.create({
      database: database.connection.client,
      encryption,
      reservedNames: RESERVED_PROJECT_SECRET_NAMES,
    }).build();
  }

  /**
   * The agent service this process serves, and where it came from.
   *
   * Precedence, and the reason for it:
   *
   *  1. An injected service wins. A host that already owns the product graph
   *     has one composed service per process, and a test that binds a double
   *     is asking for that double rather than for Postgres.
   *  2. Otherwise the process composes its own, over the guarded client
   *     {@link composeApiDatabase} opened. The two ports that used to make
   *     this impossible — the linked-workflow reads and the agent audit
   *     history — are packaged adapters now, and both are Postgres
   *     ({@link ApiAgentsComposition}).
   *  3. With neither — no host service, and no database — there is no agent
   *     service, and the tRPC router that would call one is not mounted. The
   *     same rule the secret door follows: absent beats a door that answers
   *     every call with a 500.
   *
   * One capability the composed service does not have is announced rather than
   * discovered: this process holds no Workflow application, so copying a
   * workflow agent refuses by name instead of writing an agent that points at
   * the source project's graph.
   */
  private resolveAgents(options: ApiRuntimeCompositionOptions): AgentService | undefined {
    if (this.options.agents) return this.options.agents;

    const logger = createLogger(options.config.serviceName);
    this.composedAgents = ApiAgentsComposition.tryCompose({
      database: this.composedDatabase?.connection,
      processName: options.config.serviceName,
      report: LoggedApiAgentsAbsence.create(logger),
    });
    return this.composedAgents?.agents;
  }

  /**
   * The two doors this process opens on one credential resolution: the public
   * REST families, and the subscription lane beside them.
   *
   * Each REST family is the packaged builder over the one
   * {@link ApiRestSecurity}. Secret rides the additive public-REST builder,
   * so it takes the four-callable projection; API keys is a packaged
   * framework family, so it takes the `AppRestSecurity` directly.
   *
   * The secret family is mounted only when a service was resolved, for the
   * reason {@link ApiProductionComposition.resolveSecrets} gives.
   */
  private composeDoors(
    authz: AuthzService,
    tenancy: ApiResolvedTenancy,
  ): { rest: Hono; subscriptions: ApiSubscriptionMount } {
    const secrets = this.secrets;
    // One credential resolution for both doors: the framework-shaped
    // `AppRestSecurity` every packaged REST family is built from, and the
    // four-callable projection the additive public-REST builder takes. Both
    // wrap the same `ApiRestSecurity`, so they cannot enforce differently.
    const credentials = {
      apiKeys: tenancy.apiKeys,
      authz,
      organizations: tenancy.organizations,
      ...(this.options.audit ? { audit: this.options.audit } : {}),
    };
    const restSecurity: AppRestSecurity = ApiRestSecurity.create({
      ...credentials,
      observability: ApiRestObservabilityComposition.create(),
    });
    const projectRestPolicy: ApiRestProjectPolicy = ApiRestSecurity.projectPolicy(credentials);
    return {
      rest: new Hono()
        .route(
          "/",
          secrets
            ? ApiSecretRestFeature.create({ secrets, security: projectRestPolicy })
            : new Hono(),
        )
        .route(
          "/",
          createApiKeysRestApp({
            security: restSecurity,
            apiKeys: () => tenancy.apiKeys,
            permissions: () => authz,
            audit: this.composeManagementAudit(),
          }).hono,
        ),
      // The subscription lane declares its access policy on the same security
      // every REST family does, so the one streaming route on this process is
      // a registry entry rather than an unaccounted-for endpoint. It is a
      // function because only the application holds the caller a path is
      // resolved on; see `ApiSubscriptionMount`.
      subscriptions: (ports) => createSseSubscriptionApp({ security: restSecurity, ports }).hono,
    };
  }

  /**
   * The AuthZ service this process authorizes with, and where it came from.
   *
   * Precedence, and the reason for it:
   *
   *  1. An injected service wins. A host that already owns the product graph
   *     has one AuthZ graph per process, and a second one here would give the
   *     same organization two permission caches and two epochs.
   *  2. Otherwise the process composes its own, over the guarded client
   *     {@link composeApiDatabase} opened and the producer-only Eventing
   *     runtime this process built on its own Group Queue. The two ports that
   *     used to make this impossible — the grant command dispatcher and the
   *     revocation telemetry — are what {@link ApiAuthzComposition} builds.
   *  3. With neither there is no AuthZ service, and no product transport is
   *     mounted. Every route on this process is authorized, so mounting them
   *     over a missing AuthZ would mount routes that cannot refuse.
   */
  private resolveAuthz(
    options: ApiRuntimeCompositionOptions,
    queueInfrastructure: ApiQueueInfrastructure | undefined,
  ): AuthzService | undefined {
    if (this.options.authz) return this.options.authz;

    const logger = createLogger(options.config.serviceName);
    this.composedAuthz = ApiAuthzComposition.tryCompose({
      database: this.composedDatabase?.connection,
      eventing: this.composedEventing,
      epoch: queueInfrastructure?.redis ?? null,
      config: options.config.authz,
      // The registry this process renders through `/metrics`, so the AuthZ
      // series it records are the ones a scrape returns rather than samples
      // written into a registry nothing reads.
      registry: register,
      report: LoggedApiAuthzAbsence.create(logger),
    });
    return this.composedAuthz?.permissions;
  }

  /**
   * The organization and API-key services this process serves, and where they
   * came from.
   *
   * Precedence, and the reason for it:
   *
   *  1. A host's PAIR wins. A host that already owns the product graph has one
   *     of each per process.
   *  2. Otherwise the process composes its own, together with the project
   *     service they both reach through ({@link ApiTenancyComposition}).
   *  3. With neither there is no pair, and no product transport is mounted.
   *     Every route on this process resolves a credential and authorizes it.
   *
   * A host supplying exactly ONE of them is refused by `create`, before any
   * resource is opened. The API-key service reads the project service, which
   * resolves through the organization service, so filling the gap by composing
   * the other half would hand this process an API-key service whose
   * organizations are not the organizations its own routes resolve.
   *
   * A host that injected an AuthZ service and NEITHER of these falls to (3),
   * and that is not an oversight. Both services are built from the two AuthZ
   * services as a pair, and a host hands over only the permission half — there
   * is no grants service to write their bindings through, so composing them
   * over it would produce services that can read an organization's access and
   * not change it.
   */
  private resolveTenancy(
    options: ApiRuntimeCompositionOptions,
    encryption: SecretEncryptionPort | undefined,
  ): ApiResolvedTenancy | undefined {
    const { apiKeys, organizations } = this.options;
    // `create` has already refused a half-supplied pair, so one present means
    // both are.
    if (apiKeys && organizations) return { apiKeys, organizations };

    const logger = createLogger(options.config.serviceName);
    this.composedTenancy = ApiTenancyComposition.tryCompose({
      database: this.composedDatabase?.connection,
      // The pair this process composed, never a host's single service: an
      // injected AuthZ is already reflected in `authz`, and reading it back
      // here would be reading a service whose grants half we do not hold.
      authz: this.composedAuthz
        ? { permissions: this.composedAuthz.permissions, grants: this.composedAuthz.grants }
        : undefined,
      encryption,
      pepper: options.config.apiKeyPepper,
      report: LoggedApiTenancyAbsence.create(logger),
    });
    if (!this.composedTenancy) return undefined;

    return {
      apiKeys: this.composedTenancy.apiKeys,
      organizations: this.composedTenancy.organizations,
    };
  }

  /**
   * The Auth graph this process authenticates browser callers with, and where
   * it came from.
   *
   * Precedence, and the reason for it:
   *
   *  1. An injected composition wins. A host that already owns the product
   *     graph has one Auth service per process, and a test binding a double is
   *     asking for that double rather than for Postgres.
   *  2. Otherwise the process composes the Auth service itself, over the
   *     guarded client {@link composeApiDatabase} opened, the organization
   *     service this process already serves from, and its own Redis — pairing
   *     it with the Better Auth transport the deployment supplied
   *     ({@link ApiAuthComposition}). The port that used to make this
   *     impossible, `IdentityEmailService`, is a packaged adapter now and is
   *     Postgres end to end.
   *  3. With neither — no host composition, and no supplied transport — there
   *     is no Auth graph, and the process mounts no transports at all. Every
   *     product route a person reaches resolves their session, and a process
   *     that cannot verify one has nothing to serve them.
   *
   * The transport is deliberately still received. It is one configured Better
   * Auth server instance whose options decide whether a cookie verifies at
   * all, and a second instance composed here from a different option set would
   * answer `null` for every caller rather than fail — see
   * {@link ApiAuthComposition} for the full statement.
   */
  private resolveAuth(
    options: ApiRuntimeCompositionOptions,
    tenancy: ApiResolvedTenancy,
    queueInfrastructure: ApiQueueInfrastructure | undefined,
  ): ApiAuthSessionCompositionPort | undefined {
    if (this.options.auth) return this.options.auth;

    const logger = createLogger(options.config.serviceName);
    this.composedAuth = ApiAuthComposition.tryCompose({
      database: this.composedDatabase?.connection,
      // The organization service this process actually serves from, injected
      // or composed. A second one here would resolve a person's workspaces
      // through a graph none of this process's other doors read.
      organizations: tenancy.organizations,
      browserSessions: this.options.browserSessions,
      // The SAME Redis Better Auth's own session cache lives in, so revoking a
      // session through this process clears the entry the other tier reads.
      redis: queueInfrastructure?.redis ?? null,
      processName: options.config.serviceName,
      report: LoggedApiAuthAbsence.create(logger),
    });
    return this.composedAuth;
  }

  /**
   * Composes the process's producer-only Eventing runtime over its own queue.
   *
   * Separate from the queue itself because the two absences are different
   * facts: a deployment with no Redis has no queue AND no dispatch, and a
   * reader of the boot log should see the consequence named rather than have
   * to derive it.
   */
  private composeEventing(
    options: ApiRuntimeCompositionOptions,
    queueInfrastructure: ApiQueueInfrastructure | undefined,
  ): ApiEventingInfrastructure | undefined {
    const logger = createLogger(options.config.serviceName);
    return ApiEventingInfrastructure.tryCreate({
      resources: options.resources,
      queue: queueInfrastructure,
      processName: options.config.serviceName,
      report: LoggedApiEventingAbsence.create(logger),
    });
  }

  /**
   * Bridges the packaged families' management-audit port onto this process's
   * audit sink. The port names the action, not the URL, so the action is what
   * lands in `path` — it is the stable identifier of what was done.
   */
  private composeManagementAudit(): AppRestManagementAuditPort {
    const audit = this.options.audit;
    if (!audit) {
      return () => {};
    }
    const logger = createLogger("langwatch:api:management-audit");
    return (entry) => {
      void audit
        .record({
          actorId: entry.userId,
          path: entry.action,
          input: {
            organizationId: entry.organizationId,
            action: entry.action,
            ...(entry.args === undefined ? {} : { args: entry.args }),
          },
          error: null,
        })
        .catch((error) => {
          logger.error({ error, action: entry.action }, "Management audit failed");
        });
    };
  }

  /**
   * Binds the two API-owned ports to this process's parsed config and its
   * queue's Redis.
   *
   * The connection is read per call rather than captured: an absent queue
   * means an absent Redis, and the limiter's documented degradation is to
   * count in memory instead of refusing to count at all.
   */
  private composeFeaturePorts(
    options: ApiRuntimeCompositionOptions,
    queueInfrastructure: ApiQueueInfrastructure | undefined,
  ): ApiOwnedRestFeaturePorts {
    const instanceAdminKey = ApiInstanceAdminKeyAdapter.create({ config: options.config });
    const rateLimit = ApiRateLimitInfrastructure.create({
      connection: () => queueInfrastructure?.redis,
    });
    return {
      instanceAdminKey: () => instanceAdminKey.read(),
      rateLimit: (request) => rateLimit.consume(request),
    };
  }

  /**
   * Opens this process's ClickHouse and composes the analytics half of the
   * collaborator set over it.
   *
   * ClickHouse is optional and analytics is not conditional on it: a process
   * without one still composes the applications, and the charted reads refuse
   * at the call with the message they always had rather than the namespace
   * disappearing. What a missing ClickHouse must never do is leave the record
   * unmountable, because the same namespace also carries the workbench, whose
   * database is a different one entirely.
   */
  private composeAnalytics(
    options: ApiRuntimeCompositionOptions,
    authz: AuthzService,
  ): ApiAnalyticsCollaborators | undefined {
    const database = this.composedDatabase?.connection;
    // The project service, and this process's OWN: three of the four things
    // below are project row reads — which organization a tenant routes to,
    // which organization a rollout flag targets, and which team a data-privacy
    // policy is inherited down from. A host that injected its own api-key and
    // organization pair composed no tenancy here, so it holds the collaborator
    // set whole and hands it in rather than having this half built for it.
    const projects = this.composedTenancy?.projects;
    if (!database || !projects) return undefined;

    this.composedClickHouse = ApiClickHouseInfrastructure.tryCreate({
      resources: options.resources,
      clickhouse: options.config.infrastructure.clickhouse,
      // The routing directory is the project service: which organization a
      // tenant belongs to is a project row, and it is the one question the
      // tenant router asks.
      directory: {
        organizationForTenant: async (tenantId) => await projects.getOrganizationId(tenantId),
      },
      report: LoggedApiClickHouseAbsence.create(createLogger(options.config.serviceName)),
    });

    return composeApiAnalyticsCollaborators({
      prisma: database.client,
      authz,
      projects,
      featureFlags: options.config.featureFlags,
      resolveClickHouseClient: this.composedClickHouse?.resolveClient ?? null,
      langWatchQL: options.config.infrastructure.clickhouse.langwatchQl,
      resources: options.resources,
    });
  }

  private composeQueue(options: ApiRuntimeCompositionOptions): ApiQueueInfrastructure | undefined {
    const logger = createLogger(options.config.serviceName);
    return ApiQueueInfrastructure.tryCreate({
      resources: options.resources,
      redis: options.config.infrastructure.redis,
      redisLogger: logger,
      queuePolicy: options.config.infrastructure.groupQueue,
      storage: this.options.queueStorage,
      report: LoggedApiQueueAbsence.create(logger),
    });
  }
}

/**
 * Composes the process's guarded Prisma connection from its validated config.
 *
 * A named step rather than an inline one because the client is the seam every
 * packaged `Postgres*Adapter` below takes, and there is exactly one way to
 * build it: through the packaged construction path, with the packaged tenancy
 * guard. Nothing in this process can ask for a client without them.
 */
function composeApiDatabase(
  options: ApiRuntimeCompositionOptions,
): ApiDatabaseInfrastructure | undefined {
  const logger = createLogger(options.config.serviceName);
  return ApiDatabaseInfrastructure.tryCreate({
    resources: options.resources,
    database: options.config.infrastructure.database,
    nodeEnvironment: options.config.nodeEnvironment,
    report: LoggedApiDatabaseAbsence.create(logger),
  });
}

/**
 * Composes the process's stored-secret cipher from its validated key.
 *
 * Separate from {@link composeApiDatabase} because the two absences are
 * different facts: a deployment can have a database and no key, or a key and
 * no database, and each one is worth naming on its own.
 */
function composeApiSecretEncryption(
  options: ApiRuntimeCompositionOptions,
): ApiSecretEncryptionInfrastructure | undefined {
  const logger = createLogger(options.config.serviceName);
  return ApiSecretEncryptionInfrastructure.tryCreate({
    key: options.config.storedSecretEncryptionKey,
    report: LoggedApiSecretEncryptionAbsence.create(logger),
  });
}

/**
 * The metrics transport this process serves scrapes from, and where it came
 * from.
 *
 * Precedence, and the reason for it:
 *
 *  1. An injected transport wins. A host that already owns the product graph
 *     owns one registry per process, and handing this process a second one to
 *     render would split the samples between two scrape bodies.
 *  2. Otherwise the process composes its own over the registry its packages
 *     already write into, gated by the credential it was configured with.
 *  3. With neither — no host transport, and no key in production — there is no
 *     transport, and `/metrics` is not mounted at all. Absent, so a scrape is
 *     answered "no such route" rather than by a door that refuses every caller
 *     it will ever have.
 *
 * Decided once, here, so a process serving product transports and one serving
 * only its lifecycle surface answer a scrape by the same rule.
 */
function resolveApiMetrics(input: {
  options: ApiRuntimeCompositionOptions;
  injected: ApiMetricsPort | undefined;
}): ApiMetricsPort | undefined {
  if (input.injected) return input.injected;

  const logger = createLogger(input.options.config.serviceName);
  return ApiMetricsInfrastructure.tryCreate({
    key: input.options.config.metricsApiKey,
    nodeEnvironment: input.options.config.nodeEnvironment,
    report: LoggedApiMetricsAbsence.create(logger),
  })?.metrics;
}

/** Names the absent credential once, at boot, rather than leaving it to be inferred. */
export class LoggedApiMetricsAbsence extends ApiMetricsAbsenceReportPort {
  static create(logger: Pick<Logger, "info">): LoggedApiMetricsAbsence {
    return new LoggedApiMetricsAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "info">) {
    super();
  }

  absent(): void {
    this.logger.info(
      { reason: "unconfigured" },
      "API composed without a metrics credential in production: it serves no metrics endpoint",
    );
  }
}

/** Names the absent key once, at boot, rather than leaving it to be inferred. */
export class LoggedApiSecretEncryptionAbsence extends ApiSecretEncryptionAbsenceReportPort {
  static create(logger: Pick<Logger, "info">): LoggedApiSecretEncryptionAbsence {
    return new LoggedApiSecretEncryptionAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "info">) {
    super();
  }

  absent(): void {
    this.logger.info(
      { reason: "unconfigured" },
      "API composed without a stored-secret key: it can neither read nor write project secrets",
    );
  }
}

/** Names the absent database once, at boot, rather than leaving it to be inferred. */
export class LoggedApiDatabaseAbsence extends ApiDatabaseAbsenceReportPort {
  static create(logger: Pick<Logger, "info">): LoggedApiDatabaseAbsence {
    return new LoggedApiDatabaseAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "info">) {
    super();
  }

  absent(): void {
    this.logger.info(
      { reason: "unconfigured" },
      "API composed without Postgres: no guarded Prisma client exists in this process",
    );
  }
}

/** Names the absent analytics store once, at boot, with what it costs. */
export class LoggedApiClickHouseAbsence extends ApiClickHouseAbsenceReportPort {
  static create(logger: Pick<Logger, "info">): LoggedApiClickHouseAbsence {
    return new LoggedApiClickHouseAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "info">) {
    super();
  }

  absent(): void {
    this.logger.info(
      { reason: "unconfigured" },
      "API composed without ClickHouse: the charted analytics reads and the filter pickers refuse at the call. The LangWatchQL workbench is unaffected — it runs on its own restricted identity.",
    );
  }
}

/** Names the absent dispatch once, at boot, rather than leaving it to be inferred. */
export class LoggedApiEventingAbsence extends ApiEventingAbsenceReportPort {
  static create(logger: Pick<Logger, "info">): LoggedApiEventingAbsence {
    return new LoggedApiEventingAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "info">) {
    super();
  }

  absent(): void {
    this.logger.info(
      { reason: "no-queue" },
      "API composed without a Group Queue: it can produce no commands, so it composes no service whose writes are commands",
    );
  }
}

/** Names the absent AuthZ once, at boot, rather than leaving it to be inferred. */
export class LoggedApiAuthzAbsence extends ApiAuthzAbsenceReportPort {
  static create(logger: Pick<Logger, "warn">): LoggedApiAuthzAbsence {
    return new LoggedApiAuthzAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(reason: "no-database" | "no-eventing"): void {
    this.logger.warn(
      { reason },
      "API composed no AuthZ service and no host supplied one: it mounts no product transports, because every route it would mount is authorized",
    );
  }
}

/**
 * Names what the agent service is missing once, at boot, rather than leaving it
 * to be inferred.
 *
 * Two different facts, so two different lines. No client means no agent service
 * and no agents door at all. A composed service with no workflow-copy
 * capability is a door that serves every operation but one, and a deployment
 * should read that in its own logs rather than on the first copy of a workflow
 * agent.
 */
export class LoggedApiAgentsAbsence extends ApiAgentsAbsenceReportPort {
  static create(logger: Pick<Logger, "info" | "warn">): LoggedApiAgentsAbsence {
    return new LoggedApiAgentsAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "info" | "warn">) {
    super();
  }

  absent(reason: "no-database"): void {
    this.logger.warn(
      { reason },
      "API composed no agent service and no host supplied one: it mounts no agents surface, because every operation on it reads the agent rows",
    );
  }

  withoutWorkflowCopies(): void {
    this.logger.info(
      { reason: "no-workflow-application" },
      "API composed its agent service without a workflow-copy capability: every agent operation is served except copying a workflow agent, which needs the Studio graph this process does not compose",
    );
  }
}

/** Names the absent Auth graph once, at boot, rather than leaving it inferred. */
export class LoggedApiAuthAbsence extends ApiAuthAbsenceReportPort {
  static create(logger: Pick<Logger, "warn">): LoggedApiAuthAbsence {
    return new LoggedApiAuthAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(reason: "no-database" | "no-tenancy" | "no-browser-session-transport"): void {
    this.logger.warn(
      { reason },
      reason === "no-browser-session-transport"
        ? "API composed no browser-session transport and no host supplied an Auth composition: it can authenticate no browser caller, so it mounts no transports that authenticate one. Supply the deployment's Better Auth instance — this process cannot compose a second one that verifies the same cookies"
        : "API composed no Auth service and no host supplied one: it can authenticate no browser caller, so it mounts no transports that authenticate one",
    );
  }
}

/** Names the absent credential services once, at boot, rather than leaving them inferred. */
export class LoggedApiTenancyAbsence extends ApiTenancyAbsenceReportPort {
  static create(logger: Pick<Logger, "warn">): LoggedApiTenancyAbsence {
    return new LoggedApiTenancyAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(reason: "no-database" | "no-authz" | "no-pepper"): void {
    this.logger.warn(
      { reason },
      "API composed no organization or API-key service and no host supplied them: it mounts no product transports, because every route it would mount resolves a credential",
    );
  }
}

/** Names the absent Redis once, at boot, rather than leaving it to be inferred. */
export class LoggedApiQueueAbsence extends ApiQueueAbsenceReportPort {
  static create(logger: Pick<Logger, "info">): LoggedApiQueueAbsence {
    return new LoggedApiQueueAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "info">) {
    super();
  }

  absent(reason: "disabled" | "unconfigured"): void {
    this.logger.info(
      { reason },
      "API composed without Redis: Group Queue dispatch and the Redis readiness gate are absent",
    );
  }
}

/**
 * Composes the process with only its own lifecycle surface mounted.
 *
 * The one destination for every way this process can end up with no product
 * transports — no AuthZ, no credential pair, no way to authenticate a browser
 * caller — so a deployment's health route, metrics gate, readiness order and
 * drain behaviour do not depend on WHICH of those gaps it has.
 */
function composeApiLifecycleProcess(input: {
  options: ApiRuntimeCompositionOptions;
  metrics: ApiMetricsPort | undefined;
  readiness: ApiReadinessPort | undefined;
  featureDrain: ApiFeatureDrainPort | undefined;
}): ApiRuntimeProcessPort {
  const routes = ApiProcessLifecycleRoutes.create(input.metrics ? { metrics: input.metrics } : {});
  const observability = createProcessObservability(input.options.observability);
  return ApiLifecycleOnlyProcess.create({
    listener: ApiHttpListener.create({
      application: routes,
      host: input.options.config.host,
      port: input.options.config.port,
      drainGraceMs: input.options.config.httpDrainGraceMs,
      logger: observability.logger,
    }),
    observability,
    graph: input.options.graph,
    readiness: input.readiness,
    featureDrain: input.featureDrain,
  });
}

/**
 * The API process with only its own lifecycle surface mounted. It keeps the
 * readiness-before-listen order and the shared finalization order so a
 * deployment's shutdown behaviour does not change when the product transports
 * are added.
 */
class ApiLifecycleOnlyProcess extends ApiRuntimeProcessPort {
  static create(options: {
    listener: ApiHttpListener;
    observability: ProcessObservability;
    graph: ApiProcessGraphPort;
    readiness: ApiReadinessPort | undefined;
    featureDrain: ApiFeatureDrainPort | undefined;
  }): ApiLifecycleOnlyProcess {
    return new ApiLifecycleOnlyProcess(options);
  }

  private closing: Promise<void> | undefined;

  private constructor(
    private readonly options: {
      listener: ApiHttpListener;
      observability: ProcessObservability;
      graph: ApiProcessGraphPort;
      readiness: ApiReadinessPort | undefined;
      featureDrain: ApiFeatureDrainPort | undefined;
    },
  ) {
    super();
  }

  async start(): Promise<{ host: string; port: number }> {
    await this.options.readiness?.assertReady();
    return this.options.listener.start();
  }

  close(): Promise<void> {
    this.closing ??= closeApiProcessResources({
      listener: this.options.listener,
      featureDrain: this.options.featureDrain,
      graph: this.options.graph,
      observability: this.options.observability,
    });
    return this.closing;
  }
}

/** The real listener/process whose close sequence owns graph and telemetry shutdown. */
class ApiProductionProcess extends ApiRuntimeProcessPort {
  static create(process: ApiProcess): ApiProductionProcess {
    return new ApiProductionProcess(process);
  }

  private constructor(private readonly process: ApiProcess) {
    super();
  }

  start(): Promise<{ host: string; port: number } | undefined> {
    return this.process.start();
  }

  close(): Promise<void> {
    return this.process.close();
  }
}
