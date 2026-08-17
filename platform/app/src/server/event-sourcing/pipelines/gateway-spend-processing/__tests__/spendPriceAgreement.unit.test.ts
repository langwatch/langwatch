/**
 * One confirmed outcome, three consumers, one price.
 *
 * The spend ledger, the attributed-user budget debits, and the webhook
 * envelope each consume the same event independently and at different
 * instants. This drives all three across a model-catalog change and pins
 * them to the figure the ingest seam stamped on the event, because a
 * consumer that priced the request itself would answer with whatever the
 * catalog said the moment it happened to run.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MaybeStoredLLMModelCost } from "~/server/modelProviders/llmModelCost";

const CHEAP_CATALOG: MaybeStoredLLMModelCost[] = [
  {
    projectId: "",
    model: "openai/gpt-5",
    regex: "^(openai\\/)?gpt-5$",
    inputCostPerToken: 0.0000025,
    outputCostPerToken: 0.00001,
  } as MaybeStoredLLMModelCost,
];

/** The same model repriced by a catalog deploy: ten times the money. */
const EXPENSIVE_CATALOG: MaybeStoredLLMModelCost[] = [
  {
    projectId: "",
    model: "openai/gpt-5",
    regex: "^(openai\\/)?gpt-5$",
    inputCostPerToken: 0.000025,
    outputCostPerToken: 0.0001,
  } as MaybeStoredLLMModelCost,
];

let catalog: MaybeStoredLLMModelCost[] = CHEAP_CATALOG;

vi.mock("~/server/modelProviders/llmModelCost", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("~/server/modelProviders/llmModelCost")
    >();
  return { ...original, getStaticModelCosts: () => catalog };
});

import { gatewayDebitsPM } from "@ee/governance/process-manager/gatewayDebits.process";
import {
  deliverPayloadToRow,
  webhookDeliveryPM,
} from "@ee/webhooks/process-manager/webhookDelivery.process";
import { createTenantId, EventUtils } from "~/server/event-sourcing";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";
import {
  GatewaySpendFoldProjection,
  type GatewaySpendState,
} from "../projections/gatewaySpend.foldProjection";
import type { ConfirmSpendCommandData } from "../schemas/commands";
import {
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_AGGREGATE_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_EVENT_VERSION_LATEST,
} from "../schemas/constants";
import type { GatewaySpendConfirmedEvent } from "../schemas/events";
import { rateSpendNanoUsd } from "../services/spend-rating.service";

const TENANT = "proj_price";
const ORG = "org_price";
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

const ADMITTED = {
  gateway_request_id: REQUEST,
  occurred_at: T0,
  organization_id: ORG,
  tenantId: TENANT,
  virtual_key_id: "vk_1",
  principal_user_id: "",
  end_user_id: "end-user-7",
  model: MODEL,
  model_provider_id: "mp_1",
  trace_id: "trace-1",
  request_type: "chat",
  labels: [],
  metadata: "",
  pod_id: "pod-1",
  pod_seq: 1,
};

type Handler = (
  state: unknown,
  data: unknown,
  ctx: unknown,
) => { state: unknown; intents?: unknown[] };

/** Replays a process-manager applier against a recording builder so the
 *  event handlers can be driven directly, with no store and no IO. */
function captureHandlers(apply: (builder: unknown) => unknown): {
  handlers: Map<string, Handler>;
  initial: unknown;
} {
  const handlers = new Map<string, Handler>();
  let initial: unknown;
  const builder = {
    state(s: unknown) {
      initial = s;
      return builder;
    },
    intent() {
      return builder;
    },
    on(type: string, fn: Handler) {
      handlers.set(type, fn);
      return builder;
    },
    onWake() {
      return builder;
    },
    toPayload() {
      return builder;
    },
    outbox() {
      return builder;
    },
    transient() {
      return builder;
    },
  };
  apply(builder);
  return { handlers, initial };
}

/** The payload of the single intent one outcome produced. */
function intentPayloadFor(
  apply: (builder: unknown) => unknown,
  intentName: string,
  confirmed: ConfirmSpendCommandData,
): Record<string, unknown> {
  const { handlers, initial } = captureHandlers(apply);
  const captured: unknown[] = [];
  const ctx = {
    projectId: TENANT,
    intents: {
      [intentName]: (_key: string, payload: unknown) => {
        captured.push(payload);
        return { payload };
      },
    },
  };
  const admitted = handlers.get(GATEWAY_SPEND_ADMITTED_EVENT_TYPE)!(
    initial,
    ADMITTED,
    ctx,
  );
  handlers.get(GATEWAY_SPEND_CONFIRMED_EVENT_TYPE)!(
    admitted.state,
    confirmed,
    ctx,
  );
  if (captured.length !== 1) {
    throw new Error(
      `the confirmed outcome produced ${captured.length} ${intentName} intents; the harness expects exactly one`,
    );
  }
  return captured[0] as Record<string, unknown>;
}

function confirmedEvent(
  data: ConfirmSpendCommandData,
): GatewaySpendConfirmedEvent {
  return EventUtils.createEvent({
    aggregateType: GATEWAY_SPEND_AGGREGATE_TYPE,
    aggregateId: REQUEST,
    tenantId: createTenantId(TENANT),
    type: GATEWAY_SPEND_CONFIRMED_EVENT_TYPE as Parameters<
      typeof EventUtils.createEvent
    >[0]["type"],
    version: GATEWAY_SPEND_EVENT_VERSION_LATEST,
    data,
    metadata: {},
    occurredAt: data.occurred_at,
    idempotencyKey: `${TENANT}:${REQUEST}:confirmed`,
  }) as unknown as GatewaySpendConfirmedEvent;
}

beforeEach(() => {
  catalog = CHEAP_CATALOG;
});

describe("one price per gateway request", () => {
  /** @scenario The price is fixed when the outcome is recorded and every surface repeats it */
  it("the ledger, the budget debit, and the webhook envelope agree across a catalog change", () => {
    // The ingest seam prices the outcome once, against the catalog of the
    // moment, and stamps the figure onto the command it appends.
    const priced = rateSpendNanoUsd({ model: MODEL, usage: USAGE });
    expect(priced.costNanoUsd).toBeGreaterThan(0);
    const confirmed: ConfirmSpendCommandData = {
      gateway_request_id: REQUEST,
      occurred_at: T0 + 3800,
      tenantId: TENANT,
      model: MODEL,
      model_provider_id: "mp_1",
      usage: USAGE,
      cost_nano_usd: priced.costNanoUsd,
      rate_version: priced.rateVersion,
      duration_ms: 3878,
    };

    // The ledger folds it first.
    const ledger = new GatewaySpendFoldProjection({
      store: {} as FoldProjectionStore<GatewaySpendState>,
    }).handleGatewaySpendConfirmed(
      confirmedEvent(confirmed),
      {} as GatewaySpendState,
    );

    // A catalog deploy lands before the other two consumers run. Rating
    // now really would answer differently, so the assertions below are not
    // vacuous.
    catalog = EXPENSIVE_CATALOG;
    expect(
      rateSpendNanoUsd({ model: MODEL, usage: USAGE }).costNanoUsd,
    ).not.toBe(priced.costNanoUsd);

    const debit = intentPayloadFor(
      (builder) => gatewayDebitsPM({} as never)(builder as never),
      "writeDebits",
      confirmed,
    );
    const envelope = deliverPayloadToRow(
      intentPayloadFor(
        (builder) => webhookDeliveryPM({} as never)(builder as never),
        "deliver",
        confirmed,
      ) as unknown as Parameters<typeof deliverPayloadToRow>[0],
    );

    expect(ledger.costNanoUsd).toBe(priced.costNanoUsd);
    expect(debit.cost_nano_usd).toBe(priced.costNanoUsd);
    expect(envelope.costNanoUsd).toBe(priced.costNanoUsd);
    expect(ledger.rateVersion).toBe(priced.rateVersion);
    expect(envelope.rateVersion).toBe(priced.rateVersion);
  });
});
