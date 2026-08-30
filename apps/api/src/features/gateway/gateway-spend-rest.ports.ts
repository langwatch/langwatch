/**
 * The seam between the billing reconciliation REST surface and its process.
 *
 * Two kinds of entry. The first is a capability the process composed once and
 * shares with the workers and the tRPC ledger screen — the spend-events
 * reader, the budget ledger, the webhook endpoint/event/delivery trio — so
 * this family reads exactly what the push path writes. The second is a
 * decision the application still owns: which Postgres records a filter names
 * and what they resolve to in ClickHouse, how long an outcome may still
 * arrive, and what the application calls its datastore being down.
 */
import type {
  GatewayBudgetSpendPort,
  GatewaySettlementPolicyPort,
  GatewaySpendEventsService,
} from "@langwatch/gateway-server";
import type {
  WebhookDeliveryService,
  WebhookEndpointRuntime,
  WebhookEventsService,
} from "@langwatch/enterprise-api";

export type GatewaySpendRestPorts = Readonly<{
  /**
   * The ledger reads. Undefined on a deployment without ClickHouse, where
   * there are no figures to report at all — the routes refuse rather than
   * answering a reconciliation query with a confident zero.
   */
  spendEvents: GatewaySpendEventsService | undefined;
  /** The budget ledger the per-end-user caps are read against. */
  budgetSpend: GatewayBudgetSpendPort | undefined;

  /** The endpoint registry a replay names its destination in. */
  webhookEndpoints: WebhookEndpointRuntime;
  /** The emitted-envelope log a replay walks. */
  webhookEvents: WebhookEventsService | undefined;
  /** The live delivery path a replay appends to. */
  webhookDelivery: WebhookDeliveryService | undefined;

  /**
   * How long after a request an outcome may still arrive, which is what makes
   * a recent grouping unstable under a page walk.
   */
  settlementPolicy: GatewaySettlementPolicyPort;

  /**
   * The spend filters that name Postgres records — projects, teams, the
   * caller's own external ids — resolved into the tenant and virtual-key ids
   * ClickHouse actually stores. A filter that resolves to nothing resolves to
   * an EMPTY list, never to "unfiltered".
   */
  resolveSpendScope(input: {
    organizationId: string;
    projectIds?: string[];
    teamIds?: string[];
    externalIds?: string[];
  }): Promise<{ tenantIds: string[]; virtualKeyIds?: string[] }>;

  /** Every attributed-user budget that applies to one end user, with spend. */
  endUserCaps(input: {
    organizationId: string;
    endUserId: string;
    tenantIds: string[];
    virtualKeyId?: string;
    budgetRepository: GatewayBudgetSpendPort;
  }): Promise<Array<Record<string, unknown>>>;

  /**
   * The application's own refusal for "the store these figures live in is not
   * reachable". It carries the code and the status the boundary renders, and
   * naming it here would put a second taxonomy on the same failure.
   */
  spendStoreUnavailable(): Error;
}>;
