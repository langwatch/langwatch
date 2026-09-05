import type { FoldProjectionStore } from "@langwatch/eventing";
import { AbstractFoldProjection, type FoldEventHandlers } from "@langwatch/eventing";
import type { SpendUsage } from "../processes/gateway-spend-commands.process";
import {
  GATEWAY_SPEND_PIPELINE_NAME,
  GATEWAY_SPEND_PROJECTION_VERSION_LATEST,
} from "../processes/gateway-spend-commands.process";
import {
  type GatewaySpendAdmittedEvent,
  type GatewaySpendConfirmedEvent,
  type GatewaySpendFailedEvent,
  type GatewaySpendSettledEvent,
  gatewaySpendAdmittedEventSchema,
  gatewaySpendConfirmedEventSchema,
  gatewaySpendFailedEventSchema,
  gatewaySpendSettledEventSchema,
} from "../intents/gateway-spend.intent";

const gatewaySpendEvents = [
  gatewaySpendAdmittedEventSchema,
  gatewaySpendConfirmedEventSchema,
  gatewaySpendFailedEventSchema,
  gatewaySpendSettledEventSchema,
] as const;

export type GatewaySpendStatus = "" | "admitted" | "confirmed" | "failed" | "settled";

/**
 * The spend record's working state. Every field is round-trippable through
 * the `gateway_spend` row, so the store's read-back never loses grain and
 * the delivery path never refolds from the event log in steady state.
 */
export interface GatewaySpendState {
  status: GatewaySpendStatus;
  organizationId: string;
  virtualKeyId: string;
  principalUserId: string;
  endUserId: string;
  model: string;
  /** ModelProvider row id, same identity the budget ledger's ProviderKey carries. */
  providerKey: string;
  traceId: string;
  requestType: string;
  labels: string[];
  /** Caller echo, raw JSON object string, 4KB-capped at the edge. */
  metadataJson: string;
  podId: string;
  podSeq: number;
  usage: SpendUsage | null;
  rateVersion: string;
  costNanoUsd: number;
  errorType: string;
  httpStatus: number;
  needsReconciliation: boolean;
  settleReason: string;
  /** Request time (admission), unix ms. Period placement anchors here. */
  occurredAtMs: number;
  durationMs: number;
  createdAt: number;
  updatedAt: number;
  LastEventOccurredAt: number;
}

/**
 * One aggregate per gateway REQUEST; absolute writes only (each handler SETs from the event's own content, so a redelivered event is a no-op). Status lattice, deterministic in any order: "" -> admitted -> (confirmed|failed|settled), settled -> confirmed (late confirmation resolves unknown), confirmed never downgrades. Money is copied from the outcome's own nano-USD + rate identity, never recomputed, so ledger/debits/webhook always agree. Attribution: admission is the authority and wins wherever it holds a value; when the outcome folds first (e.g. a brokered voice session, confirmed by a different emitter before its admission), the outcome's attribution fills the row so it isn't priced with no owner.
 */
interface AttributionWire {
  organization_id: string;
  virtual_key_id: string;
  principal_user_id: string;
  end_user_id: string;
  trace_id: string;
  request_type: string;
  labels: string[];
  metadata: string;
}

type AttributionFields = Pick<
  GatewaySpendState,
  | "organizationId"
  | "virtualKeyId"
  | "principalUserId"
  | "endUserId"
  | "traceId"
  | "requestType"
  | "labels"
  | "metadataJson"
>;

function attributionFromOutcome(state: GatewaySpendState, d: AttributionWire): AttributionFields {
  return {
    organizationId: state.organizationId || d.organization_id,
    virtualKeyId: state.virtualKeyId || d.virtual_key_id,
    principalUserId: state.principalUserId || d.principal_user_id,
    endUserId: state.endUserId || d.end_user_id,
    traceId: state.traceId || d.trace_id,
    requestType: state.requestType || d.request_type,
    // Read defensively: this runs on every priced outcome, and a fold that
    // throws stops the projection rather than losing one field.
    labels: state.labels?.length ? state.labels : (d.labels ?? []),
    metadataJson: state.metadataJson || d.metadata,
  };
}

/**
 * Attribution the admission states, for a row an outcome may have already named — mirrors attributionFromOutcome: admission is the authority so its value wins where it states one, but must not blank a field it never carries (e.g. traceId, only known once the span opens, after admission) that the outcome already recorded.
 */
function attributionFromAdmission(state: GatewaySpendState, d: AttributionWire): AttributionFields {
  return {
    organizationId: d.organization_id || state.organizationId,
    virtualKeyId: d.virtual_key_id || state.virtualKeyId,
    principalUserId: d.principal_user_id || state.principalUserId,
    endUserId: d.end_user_id || state.endUserId,
    traceId: d.trace_id || state.traceId,
    requestType: d.request_type || state.requestType,
    labels: d.labels?.length ? d.labels : (state.labels ?? []),
    metadataJson: d.metadata || state.metadataJson,
  };
}

export class GatewaySpendFoldProjection
  extends AbstractFoldProjection<
    GatewaySpendState,
    typeof gatewaySpendEvents,
    "createdAt",
    "updatedAt",
    "LastEventOccurredAt"
  >
  implements FoldEventHandlers<typeof gatewaySpendEvents, GatewaySpendState>
{
  readonly name = "gatewaySpend";
  readonly version = GATEWAY_SPEND_PROJECTION_VERSION_LATEST;
  readonly store: FoldProjectionStore<GatewaySpendState>;

  protected readonly events = gatewaySpendEvents;

  readonly options = {
    // No refoldOnStoreMiss: this fold is greenfield at v1, so an absent row
    // always means "new request" (ADR-066). Status lattice is deterministic
    // in any arrival order: confirmed/failed outrank settled; admission only
    // fills attribution — a late event folds on top of loaded state.
    refoldOnOutOfOrder: false,
  } as const;

  static create({
    store,
  }: {
    store: FoldProjectionStore<GatewaySpendState>;
  }): GatewaySpendFoldProjection {
    return new GatewaySpendFoldProjection({ store });
  }

  constructor({ store }: { store: FoldProjectionStore<GatewaySpendState> }) {
    super({
      createdAtKey: "createdAt",
      updatedAtKey: "updatedAt",
      LastEventOccurredAtKey: "LastEventOccurredAt",
    });
    this.store = store;
  }

  protected initState(): Omit<
    GatewaySpendState,
    "createdAt" | "updatedAt" | "LastEventOccurredAt"
  > {
    return {
      status: "",
      organizationId: "",
      virtualKeyId: "",
      principalUserId: "",
      endUserId: "",
      model: "",
      providerKey: "",
      traceId: "",
      requestType: "",
      labels: [],
      metadataJson: "",
      podId: "",
      podSeq: 0,
      usage: null,
      rateVersion: "",
      costNanoUsd: 0,
      errorType: "",
      httpStatus: 0,
      needsReconciliation: false,
      settleReason: "",
      occurredAtMs: 0,
      durationMs: 0,
    };
  }

  handleGatewaySpendAdmitted(
    event: GatewaySpendAdmittedEvent,
    state: GatewaySpendState,
  ): GatewaySpendState {
    const d = event.data;
    // A completion racing ahead of admission must not be downgraded, and the
    // outcome's RESOLVED model/provider must not be overwritten by admission's
    // requested values (rated cost derives from the resolved identity) — each
    // field sticks only when the resolved state actually carries a value.
    const outcomeResolved = state.status !== "" && state.status !== "admitted";
    return {
      ...state,
      ...attributionFromAdmission(state, d),
      status: state.status === "" ? "admitted" : state.status,
      model: outcomeResolved && state.model !== "" ? state.model : d.model,
      providerKey:
        outcomeResolved && state.providerKey !== "" ? state.providerKey : d.model_provider_id,
      podId: d.pod_id,
      podSeq: d.pod_seq,
      occurredAtMs: d.occurred_at,
    };
  }

  handleGatewaySpendConfirmed(
    event: GatewaySpendConfirmedEvent,
    state: GatewaySpendState,
  ): GatewaySpendState {
    const d = event.data;
    // Provider identity settles post-dispatch: the outcome's resolved
    // model/provider win over admitted's requested values when present.
    const model = d.model || state.model;
    const providerKey = d.model_provider_id || state.providerKey;
    return {
      ...state,
      ...attributionFromOutcome(state, d),
      status: "confirmed",
      model,
      providerKey,
      usage: d.usage,
      rateVersion: d.rate_version,
      costNanoUsd: d.cost_nano_usd,
      durationMs: d.duration_ms,
      // A confirmation resolving a settled request clears the unknown.
      needsReconciliation: false,
      settleReason: "",
      occurredAtMs: state.occurredAtMs || d.occurred_at,
    };
  }

  handleGatewaySpendFailed(
    event: GatewaySpendFailedEvent,
    state: GatewaySpendState,
  ): GatewaySpendState {
    const d = event.data;
    if (state.status === "confirmed") return state;
    const model = d.model || state.model;
    const providerKey = d.model_provider_id || state.providerKey;
    return {
      ...state,
      ...attributionFromOutcome(state, d),
      status: "failed",
      model,
      providerKey,
      errorType: d.error.type,
      httpStatus: d.error.http_status,
      // Partial usage still prices: tokens consumed before a mid-stream
      // failure are real spend on several providers.
      usage: d.usage,
      rateVersion: d.rate_version,
      costNanoUsd: d.cost_nano_usd,
      durationMs: d.duration_ms,
      needsReconciliation: false,
      settleReason: "",
      occurredAtMs: state.occurredAtMs || d.occurred_at,
    };
  }

  handleGatewaySpendSettled(
    event: GatewaySpendSettledEvent,
    state: GatewaySpendState,
  ): GatewaySpendState {
    // Settlement only resolves an open admission; a real outcome wins in
    // any order, including a settle redelivered after a late confirm.
    if (state.status === "confirmed" || state.status === "failed") {
      return state;
    }
    return {
      ...state,
      ...attributionFromOutcome(state, event.data),
      status: "settled",
      needsReconciliation: true,
      settleReason: event.data.reason,
      occurredAtMs: state.occurredAtMs || event.data.occurred_at,
    };
  }
}

export { GATEWAY_SPEND_PIPELINE_NAME };
