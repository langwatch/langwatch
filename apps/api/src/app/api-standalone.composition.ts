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
import type {
  ApiAuthSessionCompositionPort,
  ApiBrowserSessionTransportPort,
} from "./api-auth.composition";
import { ApiProductionComposition } from "./api-production.composition";

/**
 * The product services an API host hands over.
 *
 * None of them is mandatory any more, and one of them is not a service at all:
 * `browserSessions` is the deployment's own Better Auth instance, the last
 * thing on this list no package implements
 * (see API_UNAVAILABLE_PRODUCT_ADAPTERS). Everything else a host supplies
 * overrides what this process would compose for itself, and leaving any of
 * them out is a supported shape rather than a gap — with the consequences each
 * one names.
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
  /**
   * A host's already-composed Auth service and Better Auth transport.
   *
   * Optional since this process composes the Auth half itself, over its
   * guarded client, the organization service it already serves from and its
   * own Redis ({@link ApiProductionComposition.resolveAuth}). Supply it to
   * override that, or supply `browserSessions` alone and let the process build
   * the rest.
   */
  auth?: ApiAuthSessionCompositionPort;
  /**
   * The deployment's Better Auth request boundary — the one entry on
   * {@link API_UNAVAILABLE_PRODUCT_ADAPTERS}.
   *
   * Without it, and without `auth`, this process can authenticate no browser
   * caller and mounts no product transports at all.
   */
  browserSessions?: ApiBrowserSessionTransportPort;
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
 * The identity entry closed last, and it closed by SPLITTING rather than by
 * one port finding a home. It named `IdentityEmailService` and the Better Auth
 * browser-session transport together because they arrive through one option —
 * `ApiAuthSessionCompositionPort` hands over the Auth service and the
 * transport as a pair — and they were never one gap.
 *
 * `IdentityEmailService` was not process-bound at all. It answers which
 * address is a person's from the `Identifier` projection, for a user whose
 * backfill has finalized, and both halves of that are reads over this
 * process's own client: the projection, and the one migration-state row that
 * says whether the projection may answer. `PostgresIdentityEmailAdapter` is
 * both, latch cache included, and with it this process composes the whole Auth
 * service — the packaged user service under it too, its avatar storage
 * declared absent the way project deletion's two reach-outs are, because
 * reading a profile needs no object store and writing one does
 * ({@link ApiProductionComposition.resolveAuth}).
 *
 * The transport genuinely is process-bound, and the entry that remains says
 * only that. It is not a table this package could query: it is one configured
 * Better Auth server instance, and every option that decides whether a cookie
 * verifies belongs to the deployment rather than to a package — the signing
 * secret, the base URL and trusted origins, the cookie prefix, the session
 * model mapping, the secondary-storage prefix, the mounted social and
 * generic-OIDC providers whose ids a stored account row is keyed by, the
 * identity storage adapter, and the request hooks. A second instance composed
 * here from a different option set would not fail — it would verify nothing
 * and answer `null`, which every caller reads as "signed out". That failure
 * has already taken sign-in down once, and it was expensive precisely because
 * nothing recorded the refusal; the transport adapter this process wraps a
 * host's instance in now logs a presented-and-rejected session token rather
 * than treating it as an anonymous request.
 */
export const API_UNAVAILABLE_PRODUCT_ADAPTERS = [
  "The deployment's Better Auth browser-session transport",
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
 * It is {@link ApiProductionComposition} over this process's own validated
 * configuration, plus the one thing a composition cannot say for itself: the
 * executable's boot statement about what a deployment still has to hand it.
 *
 * It used to be two graphs. When the production composition could only be
 * HANDED a host's product services, a process with none of them had nothing to
 * compose, so this class built a second, smaller graph — a database, a queue
 * and the lifecycle surface — and the executable booted that one. Every seam
 * that has closed since (the stored-secret cipher, AuthZ over the process's
 * own producer-only Eventing, the organization/project/API-key trio, the agent
 * service, the Auth service) is composed by the production composition and by
 * nothing else, so the graph the executable actually booted could never reach
 * any of it. A deployment with a database, a Redis and a Better Auth transport
 * would still have served a health route and no product traffic.
 *
 * So there is one graph now, and a host's services are an OVERRIDE of what
 * this process would compose rather than the gate deciding which graph exists.
 * Degrading is the production composition's own job and it already does it:
 * each collaborator it cannot build is named at boot and it falls back to the
 * lifecycle surface — listener, readiness gate, health route, optional metrics
 * route and bounded drain.
 */
export class ApiStandaloneComposition extends ApiRuntimeCompositionPort {
  static create(options: ApiStandaloneCompositionOptions = {}): ApiStandaloneComposition {
    return new ApiStandaloneComposition(options);
  }

  private constructor(private readonly options: ApiStandaloneCompositionOptions) {
    super();
  }

  compose(options: ApiRuntimeCompositionOptions): Promise<ApiRuntimeProcessPort> {
    const products = this.options.products ?? {};
    this.announceUnsuppliedAdapters(options, products);
    return ApiProductionComposition.create({
      ...products,
      ...(this.options.readiness ? { readiness: this.options.readiness } : {}),
      ...(this.options.metrics ? { metrics: this.options.metrics } : {}),
      ...(this.options.featureDrain ? { featureDrain: this.options.featureDrain } : {}),
    }).compose(options);
  }

  /**
   * States what this deployment still has to supply, every time it boots.
   *
   * Said here rather than left to the composition below, because the two
   * statements answer different questions. The production composition reports
   * the collaborator it could not BUILD, and it only gets as far as the Auth
   * graph when it already has a database, a Redis and a credential pair — so a
   * deployment missing all four would never read the one line that names what
   * it must actually hand over. This one is the executable's own, and it does
   * not depend on how far composition got.
   */
  private announceUnsuppliedAdapters(
    options: ApiRuntimeCompositionOptions,
    products: ApiProductAdapters,
  ): void {
    if (products.auth !== undefined || products.browserSessions !== undefined) return;

    createLogger(options.config.serviceName).warn(
      { adapters: API_UNAVAILABLE_PRODUCT_ADAPTERS },
      "API process started without an adapter no package implements: it mounts no product transports until a host supplies it",
    );
  }
}
