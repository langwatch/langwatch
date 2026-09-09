/**
 * The webhook feature's application: what both doors (tRPC and REST) call.
 * Lifts only the shared decisions — one `assertEntitled` gate, one optional
 * events log — and reaches the rest through {@link endpoints}/{@link health}.
 */
import {
  WebhookApi,
  type WebhookApi as WebhookApiContract,
} from "@langwatch/webhook-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import type { WebhookEndpointRuntime } from "../adapters/webhook-endpoint.webhook-endpoint.adapter.ts";
import type { WebhookDispatchResult } from "../rules/webhook-delivery-contract.rules.ts";
import type { WebhookDestinationConfig } from "../services/webhook-destination.service.ts";
import type { WebhookEventsService } from "../services/webhook-events.service.ts";
import type { WebhookHealthService } from "../services/webhook-health.service.ts";

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

export class WebhookApp implements WebhookApiContract {
  static readonly contract = WebhookApi;
  static readonly dependencies = {};

  static create(
    setup: FeatureSetup<typeof WebhookApp.dependencies, WebhookAppDependencies, undefined>,
  ): WebhookApp;
  /** Compatibility construction used by process roots not yet on FeatureSetup. */
  static create(dependencies: WebhookAppDependencies): WebhookApp;
  static create(
    input:
      | FeatureSetup<typeof WebhookApp.dependencies, WebhookAppDependencies, undefined>
      | WebhookAppDependencies,
  ): WebhookApp {
    const dependencies = "infrastructure" in input ? input.infrastructure : input;
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
  rollSecret: WebhookApiContract["rollSecret"] = (input) => this.#dependencies.endpoints.rollSecret(input);
  enable: WebhookApiContract["enable"] = (input) => this.#dependencies.endpoints.enable(input);
  disable: WebhookApiContract["disable"] = (input) => this.#dependencies.endpoints.disable(input);
  archive: WebhookApiContract["archive"] = (input) => this.#dependencies.endpoints.archive(input);
  findDeliverable: WebhookApiContract["findDeliverable"] = (input) =>
    this.#dependencies.endpoints.findDeliverable(input);
  getDeliveries: WebhookApiContract["getDeliveries"] = (input) =>
    this.#dependencies.endpoints.getDeliveries(input);
  getHealth: WebhookApiContract["getHealth"] = (input) => this.#dependencies.health.health(input);
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
