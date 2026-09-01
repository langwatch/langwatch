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
import {
  ApiProductionComposition,
  composeApiDatabase,
  LoggedApiQueueAbsence,
} from "./api-production.composition";

/**
 * The already-composed product services an API host hands over.
 *
 * The API package cannot build these itself: every one of them needs at least
 * one port whose only implementation still lives with the legacy application
 * (see API_UNAVAILABLE_PRODUCT_ADAPTERS).
 */
export type ApiProductAdapters = Readonly<{
  agents: AgentService;
  /**
   * The one product service on this list the API package CAN build.
   *
   * A host supplies it to override what the process would compose — a test
   * binding a double, or a deployment that already owns one instance of the
   * service graph. Left out, the process composes its own from its guarded
   * client and its configured key
   * ({@link ApiProductionComposition.resolveSecrets}), and mounts no secret
   * door if it has neither.
   */
  secrets?: SecretService;
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
 *
 * The instance administrator credential and the public REST rate limiter used
 * to be on it and are not any more: {@link ApiProductionComposition} builds
 * both from its own validated configuration and its own Redis
 * ({@link ApiProductionComposition.restFeaturePorts}), so no host supplies
 * them. What still keeps the two families that READ them off this process is
 * named by the entries that remain — the organization identity ports and the
 * stored-object application — not by the credential or the counter.
 *
 * The query guards left the list for a narrower reason, and the difference
 * matters. The multitenancy, organization and mass-delete guards now live in
 * `@langwatch/prisma-client` beside the schema they classify, so this process
 * composes its own guarded client from `DATABASE_URL`
 * ({@link ApiProductionComposition.database}) and no host supplies one. That
 * unlocks the seam a packaged `Postgres*Adapter` takes — a typed
 * `PrismaClient` from a composition root — and nothing beyond it: every
 * adapter still needs the ports the remaining entries name, so composing the
 * client is not composing the services.
 *
 * The stored-secret encryption key is the first of those seams to close, and
 * with it the first product service this package composes rather than
 * receives. The key is a validated config leaf, the cipher over it is
 * `@langwatch/secret-server`'s own — so this process brings no cipher of its
 * own, and the format it writes is pinned to the one the platform app reads by
 * a row both suites decrypt — and `PostgresSecretAdapter` over the guarded
 * client turns the two into a `SecretService`
 * ({@link ApiProductionComposition.resolveSecrets}).
 *
 * `OrganizationSettingsSecretPort` left with it, and it is worth being exact
 * about why: it was on this list because the KEY was missing, and the key is
 * not missing any more — the port is the same two methods over the same
 * cipher. What still keeps the organization service out of this process is the
 * entry below that names its identity ports, and when that entry closes its
 * settings-secret port is a delegate over the cipher this process already
 * builds. Nothing here composes one today, because nothing here composes the
 * organization service that would take it.
 */
export const API_UNAVAILABLE_PRODUCT_ADAPTERS = [
  "AgentsWorkflowPort and AgentsAuditLogPort: agent workflow copies and agent audit history",
  "AuthzGrantsCommandDispatcher and AuthzRevocationTelemetry: the grant command pipeline",
  "ApiKeyBindingIdPort, ApiKeyDiagnosticsPort and the organization identity ports",
  "IdentityEmailService and the Better Auth browser-session transport",
  "ApiMetricsPort: no process-owned metric registry exists yet",
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
    composeApiDatabase(options);
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
