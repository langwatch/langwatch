import type { AgentService } from "@langwatch/agent-contract";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import type { GroupQueueStoragePort } from "@langwatch/group-queue";
import { createLogger } from "@langwatch/observability";
import {
  createProcessObservability,
  type ProcessObservability,
} from "@langwatch/observability/node";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { SecretService } from "@langwatch/secret-contract";
import { ApiHttpListener } from "../api-http.listener";
import {
  ApiMetricsPort,
  ApiProcessLifecycleRoutes,
  ApiReadinessPort,
} from "../api-process.lifecycle";
import { ApiAuditPort } from "../api-request.policy";
import { ApiFeatureDrainPort, ApiProcessGraphPort, closeApiProcessResources } from "../api.process";
import {
  ApiRuntimeCompositionPort,
  ApiRuntimeProcessPort,
  type ApiRuntimeCompositionOptions,
} from "../api.main";
import { ApiQueueInfrastructure } from "../platform/infrastructure/api-queue.infrastructure";
import type { ApiAuthSessionCompositionPort } from "./api-auth.composition";
import { ApiProductionComposition, LoggedApiQueueAbsence } from "./api-production.composition";

/**
 * The already-composed product services an API host hands over.
 *
 * The API package cannot build these itself: every one of them needs at least
 * one port whose only implementation still lives with the legacy application
 * (see API_UNAVAILABLE_PRODUCT_ADAPTERS).
 */
export type ApiProductAdapters = Readonly<{
  agents: AgentService;
  secrets: SecretService;
  apiKeys: ApiKeyService;
  authz: AuthzService;
  organizations: OrganizationService;
  auth: ApiAuthSessionCompositionPort;
  audit?: ApiAuditPort;
  queueStorage?: GroupQueueStoragePort;
}>;

/**
 * The adapters a host must supply before the standalone process can serve
 * product traffic, and the reason each one is not yet the API package's to own.
 *
 * This list is the executable's honest boot statement rather than a plan: the
 * process announces it at start so a deployment reads the gap from its own
 * logs instead of from a document.
 */
export const API_UNAVAILABLE_PRODUCT_ADAPTERS = [
  "PrismaQueryGuard: the multitenancy, organization and mass-delete query guards",
  "SecretEncryptionPort and OrganizationSettingsSecretPort: the stored-secret encryption key",
  "AgentsWorkflowPort and AgentsAuditLogPort: agent workflow copies and agent audit history",
  "AuthzGrantsCommandDispatcher and AuthzRevocationTelemetry: the grant command pipeline",
  "ApiKeyBindingIdPort, ApiKeyDiagnosticsPort and the organization identity ports",
  "IdentityEmailService and the Better Auth browser-session transport",
  "ApiMetricsPort: no process-owned metric registry exists yet",
  "PAT/admin authentication and the public REST rate limiter",
] as const;

export type ApiStandaloneCompositionOptions = {
  /** Supplied by a host that already owns the product service graph. */
  products?: ApiProductAdapters;
  readiness?: ApiReadinessPort;
  metrics?: ApiMetricsPort;
  featureDrain?: ApiFeatureDrainPort;
};

/**
 * The composition the physical API executable boots.
 *
 * With product adapters it composes the full transport graph through
 * ApiProductionComposition. Without them it still composes a real process —
 * listener, readiness gate, health route, optional metrics route and bounded
 * drain — and says which adapters it is missing, so the executable is
 * exercisable before the product graph has a home outside the legacy app.
 */
export class ApiStandaloneComposition extends ApiRuntimeCompositionPort {
  static create(options: ApiStandaloneCompositionOptions = {}): ApiStandaloneComposition {
    return new ApiStandaloneComposition(options);
  }

  private constructor(private readonly options: ApiStandaloneCompositionOptions) {
    super();
  }

  compose(options: ApiRuntimeCompositionOptions): Promise<ApiRuntimeProcessPort> {
    const products = this.options.products;
    if (products) {
      return ApiProductionComposition.create({
        ...products,
        ...(this.options.readiness ? { readiness: this.options.readiness } : {}),
        ...(this.options.metrics ? { metrics: this.options.metrics } : {}),
        ...(this.options.featureDrain ? { featureDrain: this.options.featureDrain } : {}),
      }).compose(options);
    }
    return Promise.resolve(this.composeProcessSurface(options));
  }

  private composeProcessSurface(options: ApiRuntimeCompositionOptions): ApiRuntimeProcessPort {
    const logger = createLogger(options.config.serviceName);
    const queue = ApiQueueInfrastructure.tryCreate({
      resources: options.resources,
      redis: options.config.infrastructure.redis,
      redisLogger: logger,
      queuePolicy: options.config.infrastructure.groupQueue,
      report: LoggedApiQueueAbsence.create(logger),
    });
    logger.warn(
      { adapters: API_UNAVAILABLE_PRODUCT_ADAPTERS },
      "API process started without product transports: no host supplied its service adapters",
    );

    const routes = ApiProcessLifecycleRoutes.create(
      this.options.metrics ? { metrics: this.options.metrics } : {},
    );
    const observability = createProcessObservability(options.observability);
    return ApiStandaloneProcess.create({
      listener: ApiHttpListener.create({
        application: routes,
        host: options.config.host,
        port: options.config.port,
        drainGraceMs: options.config.httpDrainGraceMs,
        logger: observability.logger,
      }),
      observability,
      graph: options.graph,
      readiness: this.options.readiness ?? queue?.readiness,
      featureDrain: this.options.featureDrain,
    });
  }
}

/**
 * The API process with only its own lifecycle surface mounted. It keeps the
 * readiness-before-listen order and the shared finalization order so a
 * deployment's shutdown behaviour does not change when the product transports
 * are added.
 */
class ApiStandaloneProcess extends ApiRuntimeProcessPort {
  static create(options: {
    listener: ApiHttpListener;
    observability: ProcessObservability;
    graph: ApiProcessGraphPort;
    readiness: ApiReadinessPort | undefined;
    featureDrain: ApiFeatureDrainPort | undefined;
  }): ApiStandaloneProcess {
    return new ApiStandaloneProcess(options);
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
