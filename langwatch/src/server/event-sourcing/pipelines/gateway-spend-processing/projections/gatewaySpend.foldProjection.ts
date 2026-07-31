import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "~/server/event-sourcing/projections/abstractFoldProjection";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";
import type { SpendUsage } from "../schemas/commands";
import {
  GATEWAY_SPEND_PROJECTION_VERSION_LATEST,
  GATEWAY_SPEND_PIPELINE_NAME,
} from "../schemas/constants";
import {
  type GatewaySpendAdmittedEvent,
  gatewaySpendAdmittedEventSchema,
  type GatewaySpendConfirmedEvent,
  gatewaySpendConfirmedEventSchema,
  type GatewaySpendFailedEvent,
  gatewaySpendFailedEventSchema,
  type GatewaySpendSettledEvent,
  gatewaySpendSettledEventSchema,
} from "../schemas/events";
import { rateSpendNanoUsd } from "../services/spend-rating.service";

const gatewaySpendEvents = [
  gatewaySpendAdmittedEventSchema,
  gatewaySpendConfirmedEventSchema,
  gatewaySpendFailedEventSchema,
  gatewaySpendSettledEventSchema,
] as const;

export type GatewaySpendStatus =
  | ""
  | "admitted"
  | "confirmed"
  | "failed"
  | "settled";

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
 * Rating happens HERE, not in the gateway: `confirmed` carries quantities
 * and the fold prices them through the same registry cascade observability
 * uses, quantized once to integer nano-USD. Replaying the log re-rates,
 * which is what makes a price correction a projection rebuild.
 */
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
    /** A row written by an older shape refolds once from the log instead of
     *  decoding column defaults into permanently wrong state. */
    refoldOnStoreMiss: true,
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
    return {
      ...state,
      // A completion that raced ahead of its admission must not downgrade.
      status: state.status === "" ? "admitted" : state.status,
      organizationId: d.organization_id,
      virtualKeyId: d.virtual_key_id,
      principalUserId: d.principal_user_id,
      endUserId: d.end_user_id,
      model: d.model,
      providerKey: d.model_provider_id,
      traceId: d.trace_id,
      requestType: d.request_type,
      labels: d.labels,
      metadataJson: d.metadata,
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
    const rated = rateSpendNanoUsd({
      model,
      usage: d.usage,
      rateVersion: d.rate_version,
    });
    return {
      ...state,
      status: "confirmed",
      model,
      providerKey,
      usage: d.usage,
      rateVersion: rated.rateVersion,
      costNanoUsd: rated.costNanoUsd,
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
    const rated = rateSpendNanoUsd({
      model,
      usage: d.usage,
    });
    return {
      ...state,
      status: "failed",
      model,
      providerKey,
      errorType: d.error.type,
      httpStatus: d.error.http_status,
      // Partial usage still prices: tokens consumed before a mid-stream
      // failure are real spend on several providers.
      usage: d.usage,
      rateVersion: rated.rateVersion,
      costNanoUsd: rated.costNanoUsd,
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
      status: "settled",
      needsReconciliation: true,
      settleReason: event.data.reason,
      occurredAtMs: state.occurredAtMs || event.data.occurred_at,
    };
  }
}

export { GATEWAY_SPEND_PIPELINE_NAME };
