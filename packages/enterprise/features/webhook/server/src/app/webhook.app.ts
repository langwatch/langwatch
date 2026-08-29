/**
 * The webhook feature's application: what both of its doors call.
 *
 * It holds every capability the feature's api files reach — the endpoint
 * store, the delivery health report, the emitted-events log, the entitlement
 * check, the last delivery hop a test fire uses, and the `Idempotency-Key`
 * ledger a create dispatches through — and it is the one typed thing a
 * transport is given. Before it, the tRPC door declared
 * `Readonly<{ gateway: { webhookEndpoints; webhookHealth } }>` and a separate
 * `assertEntitled` port, while the REST family declared its own
 * `WebhookRestServices` bag: two descriptions of one composition, neither
 * reachable from the other, and the tRPC one reaching through a `gateway` key
 * that belongs to a different feature entirely.
 *
 * What lives here as a decision is what both doors were making for themselves:
 *
 *   - **the entitlement gate.** One `assertEntitled` for the whole surface,
 *     called at the same point in both chains — after authentication and after
 *     the RBAC check, so "you don't have access" still beats "your plan
 *     doesn't include this".
 *   - **whether the events log exists at all.** A deployment without
 *     ClickHouse has no store for it, and both doors had to remember that the
 *     capability is optional.
 *
 * ## Why this application is a holder rather than a set of operations
 *
 * The endpoint store's own methods ARE the feature's operations — create,
 * update, enable, disable, archive, roll the secret, read the deliveries — and
 * both doors call them with the same arguments. Restating each one here would
 * add a layer without adding a decision. What was worth lifting is above; the
 * rest is reached through {@link endpoints} and {@link health}, which is what
 * lets the REST family move into this package as a move rather than a rewrite.
 */
import type { IdempotentRunner } from "@langwatch/api/rest";
import type { WebhookEndpointRuntime } from "../adapters/webhook-endpoint.webhook-endpoint.adapter";
import type { WebhookDispatchResult } from "../services/webhook-delivery.service";
import type { WebhookDestinationConfig } from "../services/webhook-destination.service";
import type { WebhookEventsService } from "../services/webhook-events.service";
import type { WebhookHealthService } from "../services/webhook-health.service";

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
   * One endpoint's last hop, for the test fire.
   *
   * The test has to reach exactly what real delivery reaches, including the
   * transport, so this is the same dispatch the delivery worker performs
   * rather than a second HTTP client that only knows about URLs.
   */
  dispatch: WebhookTestDispatch;
  /** The `Idempotency-Key` ledger the create dispatches through. */
  runIdempotent: IdempotentRunner;
}

export class WebhookApp {
  static create(dependencies: WebhookAppDependencies): WebhookApp {
    return new WebhookApp(dependencies);
  }

  private constructor(private readonly dependencies: WebhookAppDependencies) {}

  /** Endpoint mutation and read. */
  get endpoints(): WebhookEndpointRuntime {
    return this.dependencies.endpoints;
  }

  /** One endpoint's delivery health. */
  get health(): Pick<WebhookHealthService, "health"> {
    return this.dependencies.health;
  }

  /** The `Idempotency-Key` ledger a create dispatches through. */
  get runIdempotent(): IdempotentRunner {
    return this.dependencies.runIdempotent;
  }

  /**
   * Refuses the whole surface unless the organization's plan carries webhook
   * endpoints.
   *
   * Entitlement is process state, so the check itself arrives as a dependency;
   * what is decided here is that there is ONE of it, called the same way from
   * both doors. It raises `WebhookEndpointsNotEntitledError`, which is already
   * a handled 403, so neither door has to translate it.
   */
  assertEntitled(organizationId: string): Promise<void> {
    return this.dependencies.assertEndpointsEntitled(organizationId);
  }

  /**
   * The emitted-events log, or a plain failure when this deployment has no
   * ClickHouse to keep it in.
   *
   * Deliberately NOT a `HandledError`: a missing datastore is a deployment
   * fault with no action for the caller, so it degrades to "unknown" plus a
   * trace id at the boundary (ADR-045) rather than promising a remedy that
   * does not exist.
   */
  requireEvents(): WebhookEventsService {
    const service = this.dependencies.events;
    if (!service) throw new Error("ClickHouse is not configured");
    return service;
  }

  /** One endpoint's last delivery hop, for a test fire. */
  dispatch(...args: Parameters<WebhookTestDispatch>): ReturnType<WebhookTestDispatch> {
    return this.dependencies.dispatch(...args);
  }
}
