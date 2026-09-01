import type { AgentService } from "@langwatch/agent-contract";
import type { GroupQueueStoragePort } from "@langwatch/group-queue";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { SecretService } from "@langwatch/secret-contract";
import { createApiKeysRestApp } from "@langwatch/api-key-server";
import { Hono } from "hono";
import {
  ApiAuditPort,
  ApiRequestPolicy,
  AuthzApiAuthorizationAdapter,
} from "../api-request.policy";
import { ApiFeatureDrainPort, ApiProcess } from "../api.process";
import { ApiMetricsPort, ApiReadinessPort } from "../api-process.lifecycle";
import {
  ApiQueueAbsenceReportPort,
  ApiQueueInfrastructure,
} from "../platform/infrastructure/api-queue.infrastructure";
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
  ApiAuthSessionCompositionPort,
  AuthSessionApiAuthenticationAdapter,
} from "./api-auth.composition";
import { ApiInstanceAdminKeyAdapter } from "./api-instance-admin-key.adapter";
import { ApiRestObservabilityComposition } from "./api-rest-observability.composition";

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

/** The concrete composition port for the migrated API transports. */
export class ApiProductionComposition extends ApiRuntimeCompositionPort {
  static create(options: {
    agents: AgentService;
    secrets: SecretService;
    apiKeys: ApiKeyService;
    authz: AuthzService;
    organizations: OrganizationService;
    auth: ApiAuthSessionCompositionPort;
    audit?: ApiAuditPort;
    readiness?: ApiReadinessPort;
    metrics?: ApiMetricsPort;
    featureDrain?: ApiFeatureDrainPort;
    queueStorage?: GroupQueueStoragePort;
  }): ApiProductionComposition {
    const policy = ApiRequestPolicy.create({
      authentication: AuthSessionApiAuthenticationAdapter.create(options.auth.compose()),
      authorization: AuthzApiAuthorizationAdapter.create(options.authz),
      audit: options.audit,
    });
    // One credential resolution for both doors: the framework-shaped
    // `AppRestSecurity` every packaged REST family is built from, and the
    // four-callable projection the additive public-REST builder takes. Both
    // wrap the same `ApiRestSecurity`, so they cannot enforce differently.
    const credentials = {
      apiKeys: options.apiKeys,
      authz: options.authz,
      organizations: options.organizations,
      ...(options.audit ? { audit: options.audit } : {}),
    };
    const restSecurity = ApiRestSecurity.create({
      ...credentials,
      observability: ApiRestObservabilityComposition.create(),
    });
    const projectRestPolicy = ApiRestSecurity.projectPolicy(credentials);
    return new ApiProductionComposition(
      options.agents,
      options.secrets,
      options.apiKeys,
      options.authz,
      policy,
      restSecurity,
      projectRestPolicy,
      options.audit,
      options.readiness,
      options.metrics,
      options.featureDrain,
      options.queueStorage,
    );
  }

  private composedFeaturePorts: ApiOwnedRestFeaturePorts | undefined;

  private constructor(
    private readonly agents: AgentService,
    private readonly secrets: SecretService,
    private readonly apiKeys: ApiKeyService,
    private readonly authz: AuthzService,
    readonly policy: ApiRequestPolicy,
    private readonly restSecurity: AppRestSecurity,
    private readonly projectRestPolicy: ApiRestProjectPolicy,
    private readonly audit: ApiAuditPort | undefined,
    private readonly readiness: ApiReadinessPort | undefined,
    private readonly metrics: ApiMetricsPort | undefined,
    private readonly featureDrain: ApiFeatureDrainPort | undefined,
    private readonly queueStorage: GroupQueueStoragePort | undefined,
  ) {
    super();
  }

  compose(options: ApiRuntimeCompositionOptions): Promise<ApiRuntimeProcessPort> {
    const queueInfrastructure = this.composeQueue(options);
    this.composedFeaturePorts = this.composeFeaturePorts(options, queueInfrastructure);
    const process = ApiProcess.create({
      agents: this.agents,
      secrets: this.secrets,
      requestPolicy: this.policy,
      rest: this.composeRest(),
      observability: options.observability,
      graph: options.graph,
      featureDrain: this.featureDrain,
      readiness: this.readiness ?? queueInfrastructure?.readiness,
      metrics: this.metrics,
      listener: {
        host: options.config.host,
        port: options.config.port,
        drainGraceMs: options.config.httpDrainGraceMs,
      },
    });

    return Promise.resolve(ApiProductionProcess.create(process));
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
   * application behind `/api/files` — which is what the remaining entries of
   * `API_UNAVAILABLE_PRODUCT_ADAPTERS` name. The host that mounts those
   * families spreads these in instead of binding its own.
   */
  restFeaturePorts(): ApiOwnedRestFeaturePorts | undefined {
    return this.composedFeaturePorts;
  }

  /**
   * The public REST door: each family is the packaged builder over the one
   * {@link ApiRestSecurity}. Secret rides the additive public-REST builder,
   * so it takes the four-callable projection; API keys is a packaged
   * framework family, so it takes the `AppRestSecurity` directly.
   */
  private composeRest(): Hono {
    return new Hono()
      .route(
        "/",
        ApiSecretRestFeature.create({ secrets: this.secrets, security: this.projectRestPolicy }),
      )
      .route(
        "/",
        createApiKeysRestApp({
          security: this.restSecurity,
          apiKeys: () => this.apiKeys,
          permissions: () => this.authz,
          audit: this.composeManagementAudit(),
        }).hono,
      );
  }

  /**
   * Bridges the packaged families' management-audit port onto this process's
   * audit sink. The port names the action, not the URL, so the action is what
   * lands in `path` — it is the stable identifier of what was done.
   */
  private composeManagementAudit(): AppRestManagementAuditPort {
    const audit = this.audit;
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

  private composeQueue(options: ApiRuntimeCompositionOptions): ApiQueueInfrastructure | undefined {
    const logger = createLogger(options.config.serviceName);
    return ApiQueueInfrastructure.tryCreate({
      resources: options.resources,
      redis: options.config.infrastructure.redis,
      redisLogger: logger,
      queuePolicy: options.config.infrastructure.groupQueue,
      storage: this.queueStorage,
      report: LoggedApiQueueAbsence.create(logger),
    });
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
