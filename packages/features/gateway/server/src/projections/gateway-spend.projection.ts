import type { FoldProjectionStore } from "@langwatch/eventing";
import { AbstractFoldProjection, type FoldEventHandlers } from "@langwatch/eventing";
import type { SpendUsage } from "../processes/gateway-spend-commands.process";
import {
  GATEWAY_SPEND_PIPELINE_NAME,
  GATEWAY_SPEND_PROJECTION_VERSION_LATEST,
} from "../adapters/gateway-spend-constants.adapter";
import {
  type GatewaySpendAdmittedEvent,
  type GatewaySpendConfirmedEvent,
  type GatewaySpendFailedEvent,
  type GatewaySpendSettledEvent,
  gatewaySpendAdmittedEventSchema,
  gatewaySpendConfirmedEventSchema,
  gatewaySpendFailedEventSchema,
  gatewaySpendSettledEventSchema,
} from "../adapters/gateway-spend-events.adapter";

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
 * The gateway spend fold: one aggregate per gateway REQUEST, so per-request
 * grain is native rather than recovered, and a request that never produced
 * a span (blocked, failed, lost telemetry) still has a full record.
 *
 * Absolute writes only. Each handler SETs fields from the event's own
 * content; a redelivered event re-sets the same values, so there is no
 * applied-event bookkeeping in this state at all. The only cross-event
 * logic is the status lattice, and it is deterministic in any arrival
 * order:
 *
 *   "" -> admitted -> (confirmed | failed | settled)
 *   settled -> confirmed          (late confirmation resolves the unknown)
 *   confirmed never downgrades    (not to failed, not to settled)
 *
 * Money is copied, never recomputed: the outcome event carries the
 * integer nano-USD the ingest seam priced it at, along with the rate
 * identity that produced the figure, so this ledger, the attributed-user
 * debits, and the webhook envelope always state the same cost for a
 * request. Re-pricing is a correction against the log, never a side
 * effect of whichever consumer happened to run after a catalog deploy.
 */
/**
 * Attribution the outcome carries, for a row whose admission has not landed.
 *
 * Admission is the authority and wins wherever the state already holds a
 * value, so a normal request folds exactly as before. It matters when the
 * outcome is folded first, or alone: a brokered voice session is admitted by
 * the gateway and confirmed by the control plane, which are different
 * emitters on different paths, so the confirmation can reach the fold before
 * the admission does. Without this the row is priced correctly and named
 * nothing, which reads as spend belonging to no organization and no key.
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

function attributionFromOutcome(
  state: GatewaySpendState,
  d: AttributionWire,
): AttributionFields {
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
 * Attribution the admission states, for a row an outcome may already have
 * named.
 *
 * The mirror of {@link attributionFromOutcome}, and the same rule from the
 * other side: admission is the authority, so its value wins wherever it
 * states one, and what the outcome already recorded stands where it does not.
 * An admission that overwrote unconditionally would erase a field it never
 * carried. The trace id is exactly that field: it is only known once the
 * customer span opens, which is after admission, so a late admission on a
 * brokered voice session used to blank the trace the settlement had just
 * named.
 */
function attributionFromAdmission(
  state: GatewaySpendState,
  d: AttributionWire,
): AttributionFields {
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
    // No refoldOnStoreMiss: this fold is greenfield at version 1, so an
    // absent row always means "new request", never a lossy or pre-version
    // row. Opting in would send one event_log re-fold per admitted request
    // in steady state, the delivery-path read class ADR-066 retires. The
    // option returns WITH the first row-shape change, as that version
    // bump's transitional net, once the store reports older stamps as
    // misses and there is a population to heal.
    //
    // The status lattice is deterministic in any arrival order: confirmed
    // and failed outrank settled, and admission only fills attribution. A
    // business-time out-of-order event, routinely the late confirmation
    // superseding a settled request, folds on top of the loaded state;
    // replaying the aggregate's history from the log would derive nothing.
    refoldOnOutOfOrder: false,
  } as const;

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
    // A completion that raced ahead of its admission must not be downgraded,
    // and the outcome's RESOLVED model/provider identity must not be
    // overwritten by the admission's requested values: the rated cost was
    // derived from the resolved identity. Settlement resolves no identity
    // and an outcome may omit these fields, so each one sticks only when
    // the resolved state actually carries a value.
    const outcomeResolved = state.status !== "" && state.status !== "admitted";
    return {
      ...state,
      ...attributionFromAdmission(state, d),
      status: state.status === "" ? "admitted" : state.status,
      model: outcomeResolved && state.model !== "" ? state.model : d.model,
      providerKey:
        outcomeResolved && state.providerKey !== ""
          ? state.providerKey
          : d.model_provider_id,
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
