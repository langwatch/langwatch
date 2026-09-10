/**
 * The webhook feature's application: what both doors (tRPC and REST) call.
 * Lifts only the shared decisions — one `assertEntitled` gate, one optional
 * events log — and reaches the rest through {@link endpoints}/{@link health}.
 */
import { randomUUID } from "node:crypto";

import { WebhookApi, WebhookDestinationKind, type WebhookApi as WebhookApiContract } from "@langwatch/webhook-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { createLogger } from "@langwatch/observability";
import { nowInstant, type Instant } from "@langwatch/time";
import type { WebhookEndpointRuntime } from "../repositories/webhook-endpoint.repository.ts";
import type { WebhookRepositories } from "../repositories/webhook.repositories.ts";
import type { WebhookDispatchResult } from "../rules/webhook-delivery-contract.rules.ts";
import type { WebhookDestinationConfig } from "../services/webhook-destination.service.ts";
import { WebhookEnvelopeService } from "../services/webhook-envelope.service.ts";
import { WebhookEventsService } from "../services/webhook-events.service.ts";
import { WebhookHealthService, type WebhookHealthDeps } from "../services/webhook-health.service.ts";

/** The single-envelope batch a test fire sends. */
function testFireBody(now: Instant): string {
  return JSON.stringify({
    batch: [
      {
        id: `evt_test_${randomUUID()}`,
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
}

/**
 * What a process supplies beside the repositories the registry resolves: the
 * collaborators no repository can derive on its own (the process store a
 * health read shares with the worker's process manager, the entitlement
 * gate, and the test-fire dispatch).
 */
export interface WebhookInfrastructure {
  /** The durable process store a health read shares with the worker's
   *  delivery process manager. */
  processStore: WebhookHealthDeps["processStore"];
  assertEndpointsEntitled(organizationId: string): Promise<void>;
  dispatch: WebhookTestDispatch;
  webhookDestination: WebhookDestination;
  webhookId: WebhookId;
  webhookSecret: WebhookSecret;
}

type WebhookSetup = FeatureSetup<
  typeof WebhookApp.dependencies,
  WebhookInfrastructure,
  undefined,
  WebhookRepositories
>;

export class WebhookApp implements WebhookApiContract {
  static readonly contract = WebhookApi;
  static readonly dependencies = {};

  static create(setup: WebhookSetup): WebhookApp;
  /** Compatibility construction used by process roots not yet on FeatureSetup. */
  static create(dependencies: WebhookAppDependencies): WebhookApp;
  static create(input: WebhookSetup | WebhookAppDependencies): WebhookApp {
    if (!("repositories" in input)) return new WebhookApp(input);

    return new WebhookApp({
      endpoints: input.repositories.endpoints,
      events: WebhookEventsService.create({
        tenants: input.repositories.tenants,
        events: input.repositories.events,
        envelopes: WebhookEnvelopeService.create(),
      }),
      health: WebhookHealthService.create({
        endpoints: input.repositories.endpoints,
        processStore: input.infrastructure.processStore,
      }),
      assertEndpointsEntitled: input.infrastructure.assertEndpointsEntitled,
      dispatch: input.infrastructure.dispatch,
    });
  }

  readonly #dependencies: WebhookAppDependencies;

  private constructor(dependencies: WebhookAppDependencies) {
    this.#dependencies = dependencies;
  }

  create: WebhookApiContract["create"] = (input) => this.#dependencies.endpoints.create(input);
  getAll: WebhookApiContract["getAll"] = (input) => this.#dependencies.endpoints.getAll(input);
  getById: WebhookApiContract["getById"] = (input) => this.#dependencies.endpoints.getById(input);
  update: WebhookApiContract["update"] = (input) => this.#dependencies.endpoints.update(input);
  rollSecret: WebhookApiContract["rollSecret"] = (input) => this.#dependencies.endpoints.rollSecret(input);
  enable: WebhookApiContract["enable"] = (input) => this.#dependencies.endpoints.enable(input);
  disable: WebhookApiContract["disable"] = (input) => this.#dependencies.endpoints.disable(input);
  archive: WebhookApiContract["archive"] = (input) => this.#dependencies.endpoints.archive(input);
  findDeliverable: WebhookApiContract["findDeliverable"] = (input) =>
    this.#dependencies.endpoints.findDeliverable(input);
  getDeliveries: WebhookApiContract["getDeliveries"] = (input) =>
    this.#dependencies.endpoints.getDeliveries(input);
  getHealth: WebhookApiContract["getHealth"] = (input) => this.#dependencies.health.health(input);
  testFire: WebhookApiContract["testFire"] = async ({ organizationId, endpointId }) => {
    const { endpoints, dispatch } = this.#dependencies;
    const [secrets, destination] = await Promise.all([
      endpoints.getSigningSecrets({ organizationId, endpointId }),
      endpoints.getDestinationConfig({ organizationId, endpointId }),
    ]);
    const dispatchId = `test:${randomUUID()}`;

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

  /**
   * Reuses this process's endpoint, event and delivery graph with its
   * deployment-specific entitlement decision. This is a composition adapter,
   * not a second application graph.
   */
  withEntitlement(
    assertEndpointsEntitled: WebhookAppDependencies["assertEndpointsEntitled"],
  ): WebhookApp {
    return WebhookApp.create({ ...this.#dependencies, assertEndpointsEntitled });
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
   *  dispatch cap, which it rides the caller's own per-user limit instead
   *  of. */
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
