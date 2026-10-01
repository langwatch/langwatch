import { AwsClientConfiguration } from "@langwatch/aws-client";
import { parseOutboundProxyConfig } from "@langwatch/egress";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import type {
  EventingCommandSender,
  EventingParticipation,
  ProcessStore,
} from "@langwatch/eventing";
/**
 * The webhook feature's application: what both doors (tRPC and REST) call.
 * Lifts only the shared decisions — one `assertEntitled` gate, one optional
 * events log — and reaches the rest through {@link endpoints}/{@link health}.
 */
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { FeatureSetup } from "@langwatch/process";
import { type MembersRead } from "@langwatch/process-stores/members";
import { nowInstant, type Instant } from "@langwatch/time";
import {
  WebhookApi,
  webhookConfig,
  type WebhookDestinationKind,
  type WebhookServerConfig,
  type WebhookApi as WebhookApiContract,
  WebhookEventNotFoundError,
} from "@langwatch/webhook-contract";

import { HttpDestinationChannel } from "../channels/http/http.destination.channel.ts";
import { MemorySqsWebhookDestinationChannel } from "../channels/memory/memory.sqs-webhook-destination.channel.ts";
import {
  SqsWebhookDestinationChannel,
  sqsProxyResolver,
} from "../channels/sqs/sqs.webhook-destination.channel.ts";
import {
  buildWebhookDeliveryPipeline,
  type WebhookDeliveryDefinition,
} from "../eventing/webhook-delivery.pipeline.ts";
import type { WebhookEndpointRepository } from "../repositories/webhook-endpoint.repository.ts";
import type { WebhookRepositories } from "../repositories/webhook.repositories.ts";
import type { WebhookDispatchResult as DeliveryDispatchResult } from "../rules/webhook-delivery-contract.rules.ts";
import type { WebhookDestinationConfig } from "../rules/webhook-destination.rules.ts";
import { WebhookAccessService } from "../services/webhook-access.service.ts";
import {
  WebhookDeliveryService,
  type WebhookDeliveryProcessDeps,
} from "../services/webhook-delivery.service.ts";
import { WebhookDestinationDispatchService } from "../services/webhook-destination-dispatch.service.ts";
import { WebhookDispatchCapService } from "../services/webhook-dispatch-cap.service.ts";
import { WebhookEgressService } from "../services/webhook-egress.service.ts";
import { WebhookEndpointRequeueService } from "../services/webhook-endpoint-requeue.service.ts";
import { WebhookEndpointStreamService } from "../services/webhook-endpoint-stream.service.ts";
import { WebhookEnvelopeService } from "../services/webhook-envelope.service.ts";
import { WebhookEventsService } from "../services/webhook-events.service.ts";
import { WebhookGovernanceDeliveryService } from "../services/webhook-governance-delivery.service.ts";
import { WebhookHealthService } from "../services/webhook-health.service.ts";
import { WebhookRequestService } from "../services/webhook-request.service.ts";
import { WebhookTestBoundsService } from "../services/webhook-test-bounds.service.ts";

/** Synthetic test-fire ids; sent once and never read back by kind. */
const TEST_EVENT_KSUID_RESOURCE = "evttest";
const TEST_DISPATCH_KSUID_RESOURCE = "testdispatch";

/** The single-envelope batch a test fire sends. */
function testFireBody(now: Instant): string {
  return JSON.stringify({
    batch: [
      {
        id: generate(TEST_EVENT_KSUID_RESOURCE).toString(),
        type: "test.ping",
        created: now.toString({ fractionalSecondDigits: 3 }),
        schema_version: "1",
        data: { message: "LangWatch webhook test delivery" },
      },
    ],
  });
}

/** Records a test fire's outcome. The test itself ran, so a delivery-log
 *  write failure must never turn the documented answer into a throw. */
async function recordTestFire(
  endpoints: WebhookEndpointRepository,
  attempt: {
    organizationId: string;
    endpointId: string;
    dispatchId: string;
    outcome: "success" | "terminal";
    responseStatus?: number;
    error?: string;
  },
): Promise<void> {
  try {
    await endpoints.recordDeliveryAttempt({ ...attempt, attempt: 1, eventCount: 1 });
  } catch (error) {
    logger.warn({ error }, "test-fire delivery log write failed");
  }
}

const logger = createLogger("langwatch:webhook:app");

/** One endpoint's last hop, as the delivery worker performs it. */
export type WebhookTestDispatchInput = {
  destination: WebhookDestinationConfig;
  organizationId: string;
  endpointId: string;
  body: string;
  batchId: string;
  attempt: number;
  signingSecrets: readonly string[];
  isTestFire: boolean;
};

export type WebhookTestDispatch = (
  input: WebhookTestDispatchInput,
) => Promise<DeliveryDispatchResult>;

/** What the process composes this feature's application from. */
export interface WebhookAppDependencies {
  /** Endpoint mutation and read, constructed once with the process store. */
  endpoints: WebhookEndpointRepository;
  /** Endpoint delivery health over the kernel's process store; absent until the eventing build. */
  health?: Pick<WebhookHealthService, "health">;
  /**
   * The emitted-events log. Undefined on a deployment without ClickHouse —
   * the log has no fallback store — which {@link WebhookModule.getEventsService}
   * reports as a plain "not configured" failure.
   */
  events: WebhookEventsService | undefined;
  /** The one shared entitlement check for the whole surface. */
  assertEndpointsEntitled(organizationId: string): Promise<void>;
  /**
   * One endpoint's last hop, for the test fire: the same dispatch the
   * delivery worker performs, not a second HTTP client that only knows URLs.
   */
  dispatch: WebhookTestDispatch;
  /**
   * The tier-effective per-organization window a test fire is counted
   * against, before any dispatch — the limit the test door rides now that it
   * is exempt from the hourly dispatch cap.
   */
  testFireBounds: Pick<WebhookTestBoundsService, "assertTestFireWithinBounds">;
  /** The live-delivery endpoint stream a replay appends to, over the kernel's process store. */
  endpointStream?: WebhookEndpointStreamService;
  /** One attempt to a customer URL for another module's outbox (ADR-167 step 1). */
  requests?: WebhookRequestService;
}

const storeReads = ["rateLimiter"] as const;

type WebhookSetup = FeatureSetup<
  typeof WebhookModule.dependencies,
  MembersRead<typeof storeReads> &
    Readonly<{
      isSaas: boolean;
      /** The proxy spellings, a process fact; SQS deliveries follow them. */
      outboundProxy: Readonly<Record<string, string | undefined>>;
    }>,
  WebhookServerConfig,
  WebhookRepositories
>;

/** What the worker's delivery process manager is composed from; built only when consuming. */
type WebhookDeliveryParts = Readonly<{
  endpoints: WebhookEndpointRepository;
  retention: WebhookRepositories["retention"];
  getPlan: WebhookDeliveryProcessDeps["getPlan"];
  dispatch: () => WebhookDeliveryProcessDeps["dispatch"];
}>;

export class WebhookModule implements WebhookApiContract {
  static readonly contract = WebhookApi;
  /** The entitlement peer this app's own plan gate reads, composed in
   *  {@link WebhookModule.create} (`WebhookAccessService`). */
  static readonly dependencies = { entitlement: EntitlementApi };
  /** The test-fire door's per-organization counter. */
  static readonly reads = ["rateLimiter", "isSaas", "outboundProxy"] as const;
  static readonly config = webhookConfig;

  static create(input: WebhookSetup): WebhookModule {
    const { entitlement } = input.dependencies;
    const access = WebhookAccessService.create(entitlement);
    const caps = WebhookDispatchCapService.create({ caps: input.repositories.dispatchCaps });
    const egress = WebhookEgressService.create({
      caps,
      http: HttpDestinationChannel.create({
        tls: { rejectUnauthorized: input.members.isSaas },
      }),
    });
    const aws = AwsClientConfiguration.create({
      outboundProxy: sqsProxyResolver(parseOutboundProxyConfig(input.members.outboundProxy)),
    });
    const deliver = WebhookDeliveryService.dispatchThrough({
      destinations: WebhookDestinationDispatchService.create({
        egress,
        allowInsecureLocal: input.config.allowInsecureLocalUrls,
        sqs:
          input.tier === "memory"
            ? MemorySqsWebhookDestinationChannel.create()
            : SqsWebhookDestinationChannel.create({
                awsClientConfig: (config) => aws.build(config),
              }),
        caps,
      }),
    });

    const app = new WebhookModule({
      endpoints: input.repositories.endpoints,
      events: WebhookEventsService.create({
        tenants: input.repositories.tenants,
        events: input.repositories.events,
        envelopes: WebhookEnvelopeService.create(),
      }),
      assertEndpointsEntitled: (organizationId) => access.assertEndpointsAvailable(organizationId),
      dispatch: deliver,
      testFireBounds: WebhookTestBoundsService.create({
        entitlement: input.dependencies.entitlement,
        rateLimiter: input.members.rateLimiter,
      }),
      requests: WebhookRequestService.create({
        egress,
        deliveries: input.repositories.endpoints,
      }),
    });
    app.#delivery = {
      endpoints: input.repositories.endpoints,
      retention: input.repositories.retention,
      getPlan: (organizationId) => entitlement.getActivePlan({ organizationId }),
      dispatch: () => deliver,
    };
    return app;
  }

  #delivery: WebhookDeliveryParts | undefined;
  #requestSpendDelivery: EventingCommandSender<unknown> | undefined;
  #requestGovernanceDelivery: EventingCommandSender<unknown> | undefined;

  /** webhook_delivery for this role: the worker also hosts the delivery process manager. */
  deliveryPipeline({
    participation,
    processStore,
  }: {
    participation: EventingParticipation;
    processStore: ProcessStore;
  }): WebhookDeliveryDefinition {
    const parts = this.#delivery;
    if (parts) {
      this.#dependencies = {
        ...this.#dependencies,
        health: WebhookHealthService.create({ endpoints: parts.endpoints, processStore }),
        endpointStream: WebhookEndpointStreamService.create({ processStore }),
      };
    }
    if (participation === "produce" || !parts) return buildWebhookDeliveryPipeline({});
    const deps = {
      processStore,
      endpoints: parts.endpoints,
      pruneExpiredIdempotencyReceipts: (now: Instant) =>
        parts.retention.pruneExpiredIdempotencyReceipts({ now }),
      dispatch: parts.dispatch(),
      getPlan: parts.getPlan,
    };
    return buildWebhookDeliveryPipeline({
      deliveryProcess: WebhookDeliveryService.create(deps).processManager(),
      governanceProcess: WebhookGovernanceDeliveryService.create(deps).processManager(),
    });
  }

  connectDelivery(commands: Readonly<Record<string, EventingCommandSender<unknown>>>): void {
    this.#requestSpendDelivery = commands.requestSpendDelivery;
    this.#requestGovernanceDelivery = commands.requestGovernanceDelivery;
  }

  /** Spend keeps its own command, wire and idempotency; a governance fact takes the other. */
  requestGatewayEventDelivery: WebhookApiContract["requestGatewayEventDelivery"] = async (
    input,
  ) => {
    const sender = "spend" in input ? this.#requestSpendDelivery : this.#requestGovernanceDelivery;
    if (!sender) throw new Error("webhook_delivery is not registered in this process");
    const tenantId = "spend" in input ? input.spend.data.tenantId : input.governance.data.tenantId;
    await sender.send({ ...input, tenantId });
  };

  /** Compatibility construction used by process roots and tests not yet on
   *  FeatureSetup — kept off the `create` property itself, since the
   *  installer requires `create` to carry exactly one call signature. */
  static fromDependencies(dependencies: WebhookAppDependencies): WebhookModule {
    return new WebhookModule(dependencies);
  }

  #dependencies: WebhookAppDependencies;

  private constructor(dependencies: WebhookAppDependencies) {
    this.#dependencies = dependencies;
  }

  create: WebhookApiContract["create"] = (input) => this.#dependencies.endpoints.create(input);
  getAll: WebhookApiContract["getAll"] = (input) => this.#dependencies.endpoints.findAll(input);
  getById: WebhookApiContract["getById"] = (input) => this.#dependencies.endpoints.getById(input);
  update: WebhookApiContract["update"] = (input) => this.#dependencies.endpoints.update(input);

  applyEndpointChanges: WebhookApiContract["applyEndpointChanges"] = async ({
    status,
    ...update
  }) => {
    const { organizationId, endpointId, ...fields } = update;
    const hasFieldUpdate = Object.values(fields).some((value) => value !== undefined);
    const endpoint = hasFieldUpdate
      ? await this.update(update)
      : await this.getById({ organizationId, endpointId });

    if (status === "DISABLED" && endpoint.status === "ACTIVE") {
      return this.disable({ organizationId, endpointId });
    }
    if (status === "ACTIVE" && endpoint.status === "DISABLED") {
      return this.enable({ organizationId, endpointId });
    }
    return endpoint;
  };
  rollSecret: WebhookApiContract["rollSecret"] = (input) =>
    this.#dependencies.endpoints.rollSecret(input);
  enable: WebhookApiContract["enable"] = (input) => this.#requeue.enable(input);
  disable: WebhookApiContract["disable"] = (input) => this.#dependencies.endpoints.disable(input);
  archive: WebhookApiContract["archive"] = (input) => this.#dependencies.endpoints.archive(input);
  findDeliverable: WebhookApiContract["findDeliverable"] = (input) =>
    this.#dependencies.endpoints.findDeliverable(input);
  getDeliveries: WebhookApiContract["getDeliveries"] = (input) =>
    this.#dependencies.endpoints.getDeliveries(input);
  sendRequest: WebhookApiContract["sendRequest"] = (input) => this.requests.send(input);
  findDeliveriesBySource: WebhookApiContract["findDeliveriesBySource"] = (input) =>
    this.requests.findBySource(input);
  getHealth: WebhookApiContract["getHealth"] = (input) => this.health.health(input);
  testFire: WebhookApiContract["testFire"] = async ({ organizationId, endpointId }) => {
    const { endpoints, dispatch, testFireBounds } = this.#dependencies;
    // Counted before anything else: a refused caller never reaches the
    // receiver, and a flood never leaves this deployment's egress IPs.
    await testFireBounds.assertTestFireWithinBounds({ organizationId });

    const [secrets, destination] = await Promise.all([
      endpoints.findSigningSecrets({ organizationId, endpointId }),
      endpoints.getDestinationConfig({ organizationId, endpointId }),
    ]);
    const dispatchId = generate(TEST_DISPATCH_KSUID_RESOURCE).toString();

    try {
      // Reaches exactly what real delivery reaches, including the transport:
      // a queue endpoint's test must land on the queue, not on a URL it has none of.
      const result = await dispatch({
        destination,
        organizationId,
        endpointId,
        body: testFireBody(nowInstant()),
        batchId: dispatchId,
        attempt: 1,
        signingSecrets: secrets,
        isTestFire: true,
      });
      const delivered = result.verdict === "success";
      await recordTestFire(endpoints, {
        organizationId,
        endpointId,
        dispatchId,
        outcome: delivered ? "success" : "terminal",
        ...(result.status !== null ? { responseStatus: result.status } : {}),
      });

      return delivered
        ? {
            delivered: true,
            responseStatus: result.status,
            responseBody: (typeof result.body === "string" ? result.body : "").slice(0, 500),
          }
        : {
            delivered: false,
            responseStatus: result.status,
            responseBody: (result.error ?? "").slice(0, 500),
            error: (result.error ?? "").slice(0, 500),
          };
    } catch (error) {
      // The full message goes to the delivery log for the operator; the
      // answer carries a sanitised summary so internal dispatch wording and
      // transport details never reach the caller verbatim.
      await recordTestFire(endpoints, {
        organizationId,
        endpointId,
        dispatchId,
        outcome: "terminal",
        error: error instanceof Error ? error.message.slice(0, 500) : String(error),
      });

      return {
        delivered: false,
        responseStatus: null,
        error:
          "The test delivery could not reach the receiver; see the endpoint's delivery log for details.",
      };
    }
  };
  assertEndpointsEntitled: WebhookApiContract["assertEndpointsEntitled"] = (organizationId) =>
    this.#dependencies.assertEndpointsEntitled(organizationId);
  getEmittedEvents: WebhookApiContract["getEmittedEvents"] = (input) =>
    this.getEventsService().getEmittedEvents(input);
  getEmittedEventById: WebhookApiContract["getEmittedEventById"] = async (input) => {
    const event = await this.getEventsService().findEmittedEventById(input);
    if (!event) throw new WebhookEventNotFoundError();
    return event;
  };
  appendReplayToEndpointStream: WebhookApiContract["appendReplayToEndpointStream"] = (input) =>
    this.#requeue.appendReplay(input);

  get #requeue(): WebhookEndpointRequeueService {
    const { endpoints, endpointStream } = this.#dependencies;
    if (!endpointStream) {
      throw new Error("webhook enable and replay need the process store eventing supplies");
    }
    return WebhookEndpointRequeueService.create({ endpoints, endpointStream });
  }

  /**
   * Reuses this process's endpoint, event and delivery graph with its
   * deployment-specific entitlement decision. This is a composition adapter,
   * not a second application graph.
   */
  withEntitlement(
    assertEndpointsEntitled: WebhookAppDependencies["assertEndpointsEntitled"],
  ): WebhookModule {
    return WebhookModule.fromDependencies({ ...this.#dependencies, assertEndpointsEntitled });
  }

  /** Endpoint mutation and read. */
  get endpoints(): WebhookEndpointRepository {
    return this.#dependencies.endpoints;
  }

  /** One endpoint's delivery health. */
  get requests(): WebhookRequestService {
    const { requests } = this.#dependencies;
    if (!requests) throw new Error("webhook requests need the sender its create composes");
    return requests;
  }

  get health(): Pick<WebhookHealthService, "health"> {
    const { health } = this.#dependencies;
    if (!health) {
      throw new Error("webhook health needs the process store its eventing build supplies");
    }
    return health;
  }

  /**
   * Refuses the whole surface unless the organization's plan carries webhook
   * endpoints: one check, called the same way from both doors, raising the
   * already-handled `WebhookEndpointsNotEntitledError`.
   */
  assertEntitled(organizationId: string): Promise<void> {
    return this.#dependencies.assertEndpointsEntitled(organizationId);
  }

  /**
   * The emitted-events log as composed, absent included, so recomposing over
   * a different entitlement gate doesn't silently drop it. {@link getEventsService}
   * is what a door reads.
   */
  get events(): WebhookEventsService | undefined {
    return this.#dependencies.events;
  }

  /**
   * The emitted-events log, or a plain failure with no ClickHouse to keep it
   * in — not a `HandledError`, since a missing datastore has no caller
   * remedy and degrades to "unknown" at the boundary (ADR-045).
   */
  getEventsService(): WebhookEventsService {
    const service = this.#dependencies.events;
    if (!service) throw new Error("ClickHouse is not configured");
    return service;
  }

  /** One endpoint's last delivery hop, for a test fire. */
  dispatch(input: WebhookTestDispatchInput): Promise<DeliveryDispatchResult> {
    return this.#dependencies.dispatch(input);
  }
}

/**
 * What one delivery attempt amounted to. - `success`: the receiver has it. Clears the
 * endpoint's failure streak. - `retryable`: try again along the ladder.
 */
export type WebhookDispatchVerdict = "success" | "retryable" | "terminal";

export interface WebhookDispatchResult {
  verdict: WebhookDispatchVerdict;
  /** The receiver's HTTP status, or null for a transport that has none. A
   *  queue answers null, which is what the delivery log stores. */
  status: number | null;
  /** What the transport got back, already size-capped: a response snippet
   *  for HTTP, the queue's message id for a queue. */
  body: string;
  /** Response headers worth keeping for debugging. HTTP only. */
  responseHeaders?: Record<string, string>;
  /** How long the receiver asked us to wait, when it asked. Folded into the
   *  ladder's backoff as a floor. */
  retryAfterMs?: number;
  /** The dispatch identity actually sent, for the delivery log. */
  dispatchId: string;
  /** The failure, in the words the delivery log will show. Absent on
   *  success. */
  error?: string;
}

/** One batch, frozen, ready for whichever transport the endpoint named. */
export interface WebhookDispatchRequest {
  /** The endpoint's owner, and the scope its dispatch cap buckets by. */
  organizationId: string;
  endpointId: string;
  /** The EXACT bytes to deliver. Both transports send these unchanged, which
   *  is what makes one signature verifier work for both. */
  body: string;
  /** Stable across every retry of this batch: the delivery id. */
  batchId: string;
  /** 1-based attempt number. */
  attempt: number;
  /** Signing secrets, newest first. */
  signingSecrets: readonly string[];
  /** A drawer or CLI test rather than a real delivery. Marked
   *  non-suppressibly on the wire (ADR-040 §1) and exempt from the hourly
   *  dispatch cap, which the tier-effective per-organization
   *  `webhookTestPerMinute` window in the app's `testFire` answers instead. */
  isTestFire?: boolean;
}

export interface WebhookDestination {
  readonly kind: WebhookDestinationKind;
  /**
   * Deliver one batch and say what happened. Returns a classified verdict for anything the
   * receiving side answered.
   */
  send(request: WebhookDispatchRequest): Promise<WebhookDispatchResult>;
}

export interface WebhookId {
  newEndpointId(): string;
}

export interface WebhookSecret {
  encrypt(value: string): string;
  decrypt(value: string): string;
}
