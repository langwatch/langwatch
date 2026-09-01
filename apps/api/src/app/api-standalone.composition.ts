import type { AgentService } from "@langwatch/agent-contract";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import type { GroupQueueStoragePort } from "@langwatch/group-queue";
import { createLogger } from "@langwatch/observability";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { SecretService } from "@langwatch/secret-contract";
import { ApiMetricsPort, ApiReadinessPort } from "../api-process.lifecycle";
import { ApiAuditPort } from "../api-request.policy";
import { ApiFeatureDrainPort } from "../api.process";
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
  composeApiLifecycleProcess,
  LoggedApiQueueAbsence,
  resolveApiMetrics,
} from "./api-production.composition";

/**
 * The product services an API host hands over.
 *
 * One of them is still mandatory, and it is the one whose ports have no
 * packaged implementation at all (see API_UNAVAILABLE_PRODUCT_ADAPTERS). The
 * rest are optional: a host supplies them to override what this process would
 * compose for itself, and leaving one out is a supported shape rather than a
 * gap.
 */
export type ApiProductAdapters = Readonly<{
  /**
   * A host's already-composed agent service, when it has one.
   *
   * Optional since this process can build its own over its guarded client
   * ({@link ApiProductionComposition.resolveAgents}), with the one gap that
   * composition names: it holds no Workflow application, so copying a workflow
   * agent refuses rather than writing an agent pointing at another project's
   * graph.
   */
  agents?: AgentService;
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
  /**
   * The third and fourth product services this package CAN build, and the one
   * pair on this list a host must supply together or not at all.
   *
   * Left out, the process composes both — with the project service they reach
   * through — over its guarded client, its own AuthZ and its own cipher
   * ({@link ApiProductionComposition.resolveTenancy}). Supplying one without
   * the other is refused at boot: they are one graph, and half of it composed
   * elsewhere is two.
   */
  apiKeys?: ApiKeyService;
  /**
   * The second product service this package CAN build.
   *
   * A host supplies it to override what the process would compose — a test
   * binding a double, or a deployment that already owns one instance of the
   * service graph. Left out, the process composes its own over its guarded
   * client and its own producer-only Eventing runtime
   * ({@link ApiProductionComposition.resolveAuthz}); with neither, it mounts
   * no product transports at all, because every route it would mount is
   * authorized.
   */
  authz?: AuthzService;
  /** The pair to `apiKeys`; see it for what supplying only one means. */
  organizations?: OrganizationService;
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
 * them. What still keeps the two families that READ them off this process —
 * the organization provisioning port, the stored-object application — is that
 * no package implements either yet, which is why neither is an entry here:
 * this list names what a HOST supplies, not every port that has no home.
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
 *
 * The grant command pipeline left next, and it is the first entry to close by
 * this process composing INFRASTRUCTURE rather than by a port moving into a
 * package. Both collaborators the AuthZ adapter asked for were already the
 * feature's shape and neither had a packaged implementation: the revocation
 * telemetry needed a metric registry, which this process now owns, and the
 * grant command dispatcher needed an Eventing runtime with the grants pipeline
 * registered. This process registers it — the SAME packaged definition the
 * worker installs, over a PRODUCER-only runtime on its own Group Queue. It
 * consumes nothing and owns no event log: the worker claims
 * `event-sourcing/jobs`, and a command's routing metadata is stamped from the
 * pipeline and command names at send time, so where a command was produced is
 * not a fact the consumer needs. Forking the definition would have been the
 * one unacceptable way to do this, and nothing here does.
 *
 * `ApiMetricsPort` left the list last of the process-owned entries, and it
 * left for a different reason from
 * everything above it: nothing it needed lived with the legacy application at
 * all. It was here because no LangWatch package exposed a scrape surface for a
 * standalone process to compose, so the Group Queue samples this process
 * records went into a registry nothing could ever read. This process now
 * renders that registry itself, behind the credential every tier already
 * reads ({@link resolveApiMetrics}). It unlocks no product transport, and it
 * is worth saying so: what a process can be scraped for is not what it can
 * serve.
 *
 * The organization and API-key entry closed last, and it closed for a reason
 * worth separating from the others: its ports had ALREADY moved. The identity
 * minters, the diagnostics shims, the API-key binding-id and the project
 * credential format are the feature packages' own, and have been since they
 * moved there with the formats they mint. What kept the entry open was the
 * collaborator underneath them — an AuthZ service and its grants half — plus
 * two values that resolve from this process's environment and could not have
 * lived in a package at all: the settings cipher, which is the one the
 * stored-secret family already runs under, and the API-key pepper, which is
 * the HMAC key a stored credential hash is derived under. This process has all
 * three now, so the three services compose here as one graph.
 *
 * Not everything the platform app gives that graph came with it, and the gap
 * is named rather than hidden: a project deleted through this process leaves
 * its ClickHouse key map and its stored objects to the tier that owns them,
 * because the packaged adapter declares both ports optional and this process
 * holds neither system.
 *
 * The agent entry closed next, and it closed the way the others did — by the
 * ports getting a packaged implementation — with one difference worth being
 * exact about. `AgentsWorkflowPort` and `AgentsAuditLogPort` were on this list
 * because they had exactly one implementation anywhere and it was the legacy
 * application's, not because either needed the application. Read one operation
 * at a time, almost none of it did: the fields a linked Studio graph declares,
 * the workflow's name, archiving it, deleting it after a failed copy, and the
 * `agents.` audit entries that make up an agent's history are all reads and
 * writes over this process's own client. `PostgresAgentAdapter` is all of them
 * ({@link ApiProductionComposition.resolveAgents}).
 *
 * ONE operation genuinely did need it, and this process declares that gap the
 * way the project deletion above declares its two. Copying a WORKFLOW agent
 * copies the Studio graph it points at, which is the Workflow lifecycle's own
 * copy — a dataset copier, a DSL rewrite and the version rules behind them —
 * and this process composes no Workflow application. So it composes no
 * workflow-copy port, and the agent service it builds refuses that one
 * operation by name and announces the gap at boot. It cannot skip it: an agent
 * copied without its graph is an agent pointing at the source project's
 * workflow, which reads to every caller as a copy that succeeded.
 *
 * The one entry that remains still names ports whose only implementation is
 * the legacy application's.
 */
export const API_UNAVAILABLE_PRODUCT_ADAPTERS = [
  "IdentityEmailService and the Better Auth browser-session transport",
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

    return composeApiLifecycleProcess({
      options,
      metrics: resolveApiMetrics({ options, injected: this.options.metrics }),
      readiness: this.options.readiness ?? queue?.readiness,
      featureDrain: this.options.featureDrain,
    });
  }
}
