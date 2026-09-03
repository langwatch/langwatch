/**
 * One confirmed outcome, three consumers, one price.
 *
 * The spend ledger, the attributed-user budget debits, and the webhook
 * envelope each consume the same `lw.gateway.spend.confirmed` event
 * independently: the gateway-server fold, the governance-server debit
 * process, and the enterprise webhook delivery process. This drives all
 * three off one stamped event and proves none of them re-rates the request
 * itself — each one only copies `cost_nano_usd`/`rate_version` off the event
 * data, so a consumer that priced the request again would answer with
 * whatever the catalog says the moment it happened to run, not what the
 * customer was actually charged.
 *
 * Composed here, in the composition root, because the three consumers live
 * in three different feature packages (gateway-server, governance-server,
 * enterprise-webhook-server) that may not import one another.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The price the ingest seam stamped on the event, controlled by the test
 * rather than a real catalog lookup. A `vi.hoisted` cell so the mock factory
 * below (hoisted above these imports) can close over it.
 */
const priceState = vi.hoisted(() => ({
  costNanoUsd: 21_675,
  rateVersion: "catalog@2026-07-01",
}));

vi.mock("@langwatch/gateway-server", async (importOriginal) => {
  const original = await importOriginal<typeof import("@langwatch/gateway-server")>();
  return {
    ...original,
    rateSpendNanoUsd: () => ({ ...priceState }),
  };
});

import {
  buildProcessDefinition,
  buildProcessManager,
  createTenantId,
  EventUtils,
  type FoldProjectionStore,
  type ProcessDefinition,
  type ProcessEventEnvelope,
} from "@langwatch/eventing";
import {
  createGatewaySpendFoldProjection,
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_AGGREGATE_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_EVENT_VERSION_LATEST,
  rateSpendNanoUsd,
  type ConfirmSpendCommandData as GatewayConfirmSpendCommandData,
  type GatewaySpendConfirmedEvent,
  type GatewaySpendState,
} from "@langwatch/gateway-server";
import {
  GATEWAY_DEBITS_PROCESS_NAME,
  GatewayDebitPort,
  GatewayDebitProcess,
  type GatewayBudgetCrossingCandidate,
  type GatewayBudgetDebitRow,
  type GatewayDebitsState,
  type GatewayResolvedBudget,
  type GatewaySpendProcessingEvent as GovernanceGatewaySpendProcessingEvent,
} from "@langwatch/enterprise-governance-server";
import {
  WebhookDeliveryService,
  WEBHOOK_DELIVERY_PROCESS_NAME,
  type ConfirmSpendCommandData as WebhookConfirmSpendCommandData,
  type WebhookDeliveryProcessDeps,
  type WebhookDeliveryState,
  type GatewaySpendProcessingEvent as WebhookGatewaySpendProcessingEvent,
} from "@langwatch/enterprise-webhook-server";

const TENANT = "proj_price";
const REQUEST = "01K1PRICEULID";
const MODEL = "openai/gpt-5";
const T0 = Date.UTC(2026, 6, 27, 14, 3, 7);
const USAGE = {
  input_tokens: 869,
  output_tokens: 207,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  reasoning_tokens: 0,
  cache_creation_1h_tokens: 0,
  input_audio_tokens: 0,
  output_audio_tokens: 0,
  input_chars: 0,
  audio_ms: 0,
};

/** Attribution the outcome states about itself — every consumer below
 *  resolves it straight off the confirmed event, no admission required. */
const ATTRIBUTION = {
  organization_id: "org_1",
  virtual_key_id: "vk_1",
  end_user_id: "end-user-7",
  trace_id: "",
  request_type: "chat",
  labels: [] as string[],
  metadata: "",
  admitted_at: T0,
  principal_user_id: "",
  team_id: "team_1",
};

function confirmedData(costNanoUsd: number, rateVersion: string) {
  return {
    gateway_request_id: REQUEST,
    occurred_at: T0 + 3800,
    tenantId: TENANT,
    model: MODEL,
    model_provider_id: "mp_1",
    usage: USAGE,
    cost_nano_usd: costNanoUsd,
    rate_version: rateVersion,
    duration_ms: 3878,
    ...ATTRIBUTION,
  };
}

// ---------------------------------------------------------------------------
// The ledger: gateway-server's spend fold.
// ---------------------------------------------------------------------------

function ledgerCostFor(costNanoUsd: number, rateVersion: string) {
  const event = EventUtils.createEvent({
    aggregateType: GATEWAY_SPEND_AGGREGATE_TYPE,
    aggregateId: REQUEST,
    tenantId: createTenantId(TENANT),
    type: GATEWAY_SPEND_CONFIRMED_EVENT_TYPE as Parameters<
      typeof EventUtils.createEvent
    >[0]["type"],
    version: GATEWAY_SPEND_EVENT_VERSION_LATEST,
    data: confirmedData(costNanoUsd, rateVersion) as GatewayConfirmSpendCommandData,
    metadata: {},
    occurredAt: T0 + 3800,
    idempotencyKey: `${TENANT}:${REQUEST}:confirmed`,
  }) as unknown as GatewaySpendConfirmedEvent;

  const state = createGatewaySpendFoldProjection(
    {} as FoldProjectionStore<GatewaySpendState>,
  ).handleGatewaySpendConfirmed(event, {} as GatewaySpendState);
  return { costNanoUsd: state.costNanoUsd, rateVersion: state.rateVersion };
}

// ---------------------------------------------------------------------------
// The debit: governance-server's gateway-debits process.
// ---------------------------------------------------------------------------

class NoopGatewayDebitPort extends GatewayDebitPort {
  resolve(): Promise<GatewayResolvedBudget[]> {
    return Promise.resolve([]);
  }
  insert(_rows: GatewayBudgetDebitRow[]): Promise<void> {
    return Promise.resolve();
  }
  detectCrossings(_rows: GatewayBudgetCrossingCandidate[]): Promise<void> {
    return Promise.resolve();
  }
  shouldEmitBudgetUpdated(): Promise<boolean> {
    return Promise.resolve(false);
  }
  emitBudgetUpdated(): Promise<void> {
    return Promise.resolve();
  }
}

function debitEvent(costNanoUsd: number, rateVersion: string): ProcessEventEnvelope {
  return {
    eventId: `${GATEWAY_SPEND_CONFIRMED_EVENT_TYPE}:${T0}`,
    eventType: GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
    occurredAt: T0,
    tenantId: TENANT,
    projectId: TENANT,
    processKey: REQUEST,
    payload: confirmedData(costNanoUsd, rateVersion),
  };
}

function debitPayloadFor(costNanoUsd: number, rateVersion: string) {
  const service = GatewayDebitProcess.create(new NoopGatewayDebitPort());
  const def = buildProcessDefinition(
    buildProcessManager<GovernanceGatewaySpendProcessingEvent>({
      name: GATEWAY_DEBITS_PROCESS_NAME,
      applier: service.processManager(),
    }).config,
  ) as ProcessDefinition<GatewayDebitsState>;

  const result = def.evolve({
    previousState: def.initialState,
    ref: { processName: GATEWAY_DEBITS_PROCESS_NAME, projectId: TENANT, processKey: REQUEST },
    input: { kind: "event", now: T0, event: debitEvent(costNanoUsd, rateVersion) },
  });
  if (result.intents.length !== 1) {
    throw new Error(`expected one debit intent, got ${result.intents.length}`);
  }
  return result.intents[0]!.payload as { cost_nano_usd: number; rate_version: string };
}

// ---------------------------------------------------------------------------
// The webhook envelope: the enterprise webhook delivery process.
// ---------------------------------------------------------------------------

function webhookEvent(costNanoUsd: number, rateVersion: string): ProcessEventEnvelope {
  return {
    eventId: `${GATEWAY_SPEND_CONFIRMED_EVENT_TYPE}:${T0}`,
    eventType: GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
    occurredAt: T0,
    tenantId: TENANT,
    projectId: TENANT,
    processKey: REQUEST,
    payload: confirmedData(costNanoUsd, rateVersion),
  };
}

function envelopeFor(costNanoUsd: number, rateVersion: string) {
  const service = WebhookDeliveryService.create({} as WebhookDeliveryProcessDeps);
  const def = buildProcessDefinition(
    buildProcessManager<WebhookGatewaySpendProcessingEvent>({
      name: WEBHOOK_DELIVERY_PROCESS_NAME,
      applier: service.processManager(),
    }).config,
  ) as ProcessDefinition<WebhookDeliveryState>;

  const result = def.evolve({
    previousState: def.initialState,
    ref: { processName: WEBHOOK_DELIVERY_PROCESS_NAME, projectId: TENANT, processKey: REQUEST },
    input: { kind: "event", now: T0, event: webhookEvent(costNanoUsd, rateVersion) },
  });
  if (result.intents.length !== 1) {
    throw new Error(`expected one deliver intent, got ${result.intents.length}`);
  }
  const row = WebhookDeliveryService.payloadToRow(
    result.intents[0]!.payload as unknown as Parameters<
      typeof WebhookDeliveryService.payloadToRow
    >[0],
  );
  return { costNanoUsd: row.costNanoUsd, rateVersion: row.rateVersion };
}

beforeEach(() => {
  priceState.costNanoUsd = 21_675;
  priceState.rateVersion = "catalog@2026-07-01";
});

describe("one price per gateway request", () => {
  /** @scenario The price is fixed when the outcome is recorded and every surface repeats it */
  it("the ledger, the budget debit, and the webhook envelope agree across a catalog change", () => {
    // The ingest seam prices the outcome once, against the catalog of the
    // moment, and stamps the figure onto the event data below.
    const priced = rateSpendNanoUsd({ model: MODEL, usage: USAGE });
    expect(priced.costNanoUsd).toBe(21_675);

    // A catalog deploy lands before the other consumers run. Rating now
    // really would answer differently, so the assertions below are not
    // vacuous: a consumer that re-rated would disagree with the stamp.
    priceState.costNanoUsd = 216_750;
    priceState.rateVersion = "catalog@2026-08-01";
    expect(rateSpendNanoUsd({ model: MODEL, usage: USAGE }).costNanoUsd).not.toBe(
      priced.costNanoUsd,
    );

    const ledger = ledgerCostFor(priced.costNanoUsd, priced.rateVersion);
    const debit = debitPayloadFor(priced.costNanoUsd, priced.rateVersion);
    const envelope = envelopeFor(priced.costNanoUsd, priced.rateVersion);

    expect(ledger.costNanoUsd).toBe(priced.costNanoUsd);
    expect(debit.cost_nano_usd).toBe(priced.costNanoUsd);
    expect(envelope.costNanoUsd).toBe(priced.costNanoUsd);
    expect(ledger.rateVersion).toBe(priced.rateVersion);
    expect(debit.rate_version).toBe(priced.rateVersion);
    expect(envelope.rateVersion).toBe(priced.rateVersion);
  });
});
