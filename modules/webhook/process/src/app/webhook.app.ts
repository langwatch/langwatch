import { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureSetup } from "@langwatch/kernel";
/**
 * The webhook feature's application: what both doors (tRPC and REST) call.
 * Lifts only the shared decisions — one `assertEntitled` gate, one optional
 * events log — and reaches the rest through {@link endpoints}/{@link health}.
 */
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { reads, type MembersRead } from "@langwatch/process-stores/members";
import { nowInstant, type Instant } from "@langwatch/time";
import {
  WebhookApi,
  type WebhookDestinationKind,
  type WebhookApi as WebhookApiContract,
} from "@langwatch/webhook-contract";

import type { WebhookEndpointRuntime } from "../repositories/webhook-endpoint.repository.ts";
import type { WebhookRepositories } from "../repositories/webhook.repositories.ts";
import type { WebhookDestinationConfig } from "../services/webhook-destination.service.ts";
import { WebhookEndpointStreamService } from "../services/webhook-endpoint-stream.service.ts";
import { WebhookEnvelopeService } from "../services/webhook-envelope.service.ts";
import { WebhookEventsService } from "../services/webhook-events.service.ts";
import { WebhookHealthService } from "../services/webhook-health.service.ts";
import { WebhookTestBoundsService } from "../services/webhook-test-bounds.service.ts";
import { buildWebhookComposition } from "./webhook-composition.build.ts";

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
  endpoints: WebhookEndpointRuntime,
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
export type WebhookTestDispatch = (input: {
  destination: WebhookDestinationConfig;
  organizationId: string;
  endpointId: string;
  body: string;
  batchId: string;
  attempt: number;
  signingSecrets: readonly string[];
  isTestFire: boolean;
}) => Promise<WebhookDispatchResult>;

/** What the process composes this feature's application from. */
export interface WebhookAppDependencies {
  /** Endpoint mutation and read, constructed once with the process store. */
  endpoints: WebhookEndpointRuntime;
  /** Endpoint delivery health, sharing the same durable process store. */
  health: Pick<WebhookHealthService, "health">;
  /**
   * The emitted-events log. Undefined on a deployment without ClickHouse —
   * the log has no fallback store — which {@link WebhookApp.requireEvents}
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
  /**
   * The same coalescing endpoint stream the delivery worker appends live
   * spend outcomes to, shared over the process's one `processStore` member
   * so a replay rides the exact live-delivery machinery.
   */
  endpointStream: WebhookEndpointStreamService;
}

type WebhookSetup = FeatureSetup<
  typeof WebhookApp.dependencies,
  MembersRead<typeof WebhookApp.reads>,
  undefined,
  WebhookRepositories
>;

export class WebhookApp implements WebhookApiContract {
  static readonly contract = WebhookApi;
  /** The entitlement peer this app's own plan gate reads, composed in
   *  {@link buildWebhookComposition} (`WebhookAccessService`). */
  static readonly dependencies = { entitlement: EntitlementApi };
  /** The test-fire door's per-organization counter. */
  static readonly reads = reads("rateLimiter");

  static create(input: WebhookSetup): WebhookApp {
    const built = buildWebhookComposition({
      entitlement: input.dependencies.entitlement,
    });

    return new WebhookApp({
      endpoints: input.repositories.endpoints,
      events: WebhookEventsService.create({
        tenants: input.repositories.tenants,
        events: input.repositories.events,
        envelopes: WebhookEnvelopeService.create(),
      }),
      health: WebhookHealthService.create({
        endpoints: input.repositories.endpoints,
        processStore: input.repositories.processStore,
      }),
      assertEndpointsEntitled: built.assertEndpointsEntitled.bind(built),
      dispatch: built.dispatch,
      testFireBounds: WebhookTestBoundsService.create({
        entitlement: input.dependencies.entitlement,
        rateLimiter: input.members.rateLimiter,
      }),
      endpointStream: WebhookEndpointStreamService.create({
        processStore: input.repositories.processStore,
      }),
    });
  }

  /** Compatibility construction used by process roots and tests not yet on
   *  FeatureSetup — kept off the `create` property itself, since the
   *  installer requires `create` to carry exactly one call signature. */
  static fromDependencies(dependencies: WebhookAppDependencies): WebhookApp {
    return new WebhookApp(dependencies);
  }

  readonly #dependencies: WebhookAppDependencies;

  private constructor(dependencies: WebhookAppDependencies) {
    this.#dependencies = dependencies;
  }

  create: WebhookApiContract["create"] = (input) => this.#dependencies.endpoints.create(input);
  getAll: WebhookApiContract["getAll"] = (input) => this.#dependencies.endpoints.getAll(input);
  getById: WebhookApiContract["getById"] = (input) => this.#dependencies.endpoints.getById(input);
  update: WebhookApiContract["update"] = (input) => this.#dependencies.endpoints.update(input);
  rollSecret: WebhookApiContract["rollSecret"] = (input) =>
    this.#dependencies.endpoints.rollSecret(input);
  enable: WebhookApiContract["enable"] = (input) => this.#dependencies.endpoints.enable(input);
  disable: WebhookApiContract["disable"] = (input) => this.#dependencies.endpoints.disable(input);
  archive: WebhookApiContract["archive"] = (input) => this.#dependencies.endpoints.archive(input);
  findDeliverable: WebhookApiContract["findDeliverable"] = (input) =>
    this.#dependencies.endpoints.findDeliverable(input);
  getDeliveries: WebhookApiContract["getDeliveries"] = (input) =>
    this.#dependencies.endpoints.getDeliveries(input);
  getHealth: WebhookApiContract["getHealth"] = (input) => this.#dependencies.health.health(input);
  testFire: WebhookApiContract["testFire"] = async ({ organizationId, endpointId }) => {
    const { endpoints, dispatch, testFireBounds } = this.#dependencies;
    // Counted before anything else: a refused caller never reaches the
    // receiver, and a flood never leaves this deployment's egress IPs.
    await testFireBounds.assertTestFireWithinBounds({ organizationId });

    const [secrets, destination] = await Promise.all([
      endpoints.getSigningSecrets({ organizationId, endpointId }),
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
            responseBody: String(result.body ?? "").slice(0, 500),
          }
        : {
            delivered: false,
            responseStatus: result.status,
            error: String(result.error ?? "").slice(0, 500),
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
    this.requireEvents().getEmittedEvents(input);
  findEmittedEventById: WebhookApiContract["findEmittedEventById"] = (input) =>
    this.requireEvents().findEmittedEventById(input);
  appendReplayToEndpointStream: WebhookApiContract["appendReplayToEndpointStream"] = async ({
    organizationId,
    endpoint,
    envelope,
    replayId,
  }) => {
    // The caller (the gateway's replay route) names the endpoint by id only;
    // the stream needs its live delivery controls (batch size, delay,
    // in-flight cap), so this re-resolves the full deliverable view rather
    // than trusting the caller's reduced projection.
    const deliverable = await this.#dependencies.endpoints.findDeliverable({
      organizationId,
      endpointId: endpoint.id,
    });
    if (!deliverable) {
      throw new Error(`webhook endpoint ${endpoint.id} is not deliverable for replay`);
    }

    await this.#dependencies.endpointStream.appendReplay({
      organizationId,
      endpoint: deliverable,
      envelope,
      replayId,
    });
  };

  /**
   * Reuses this process's endpoint, event and delivery graph with its
   * deployment-specific entitlement decision. This is a composition adapter,
   * not a second application graph.
   */
  withEntitlement(
    assertEndpointsEntitled: WebhookAppDependencies["assertEndpointsEntitled"],
  ): WebhookApp {
    return WebhookApp.fromDependencies({ ...this.#dependencies, assertEndpointsEntitled });
  }

  /** Endpoint mutation and read. */
  get endpoints(): WebhookEndpointRuntime {
    return this.#dependencies.endpoints;
  }

  /** One endpoint's delivery health. */
  get health(): Pick<WebhookHealthService, "health"> {
    return this.#dependencies.health;
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
   * a different entitlement gate doesn't silently drop it. {@link requireEvents}
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
  requireEvents(): WebhookEventsService {
    const service = this.#dependencies.events;
    if (!service) throw new Error("ClickHouse is not configured");
    return service;
  }

  /** One endpoint's last delivery hop, for a test fire. */
  dispatch(...args: Parameters<WebhookTestDispatch>): ReturnType<WebhookTestDispatch> {
    return this.#dependencies.dispatch(...args);
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
