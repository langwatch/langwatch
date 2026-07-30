// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Gateway spend as derived state (ADR-107 decision 17, pre-built map): one
 * gateway request's spend, derived from the single span the gateway emits for
 * it, before the budgets it applies to are known. Idempotent on
 * `(TenantId, BudgetId, GatewayRequestId)` — see `gatewayBudgetDebits.store.ts`.
 */

import type {
  AppendStore,
  BuiltMap,
  WireEvent,
} from "@langwatch/event-sourcing";
import type { GatewayBudgetLedgerStatus } from "@prisma/client";
import type { CanonicalSpan } from "~/server/event-sourcing/trace-processing/schema";

export const GATEWAY_VIRTUAL_KEY_ID_ATTR = "langwatch.virtual_key_id";
export const GATEWAY_REQUEST_ID_ATTR = "langwatch.gateway_request_id";
export const GATEWAY_MODEL_PROVIDER_ID_ATTR = "langwatch.model_provider_id";

/** Cheap presence gate: does this canonical span carry a gateway virtual-key marker? */
export function spanCarriesGatewayVirtualKeyId(span: {
  readonly attributes: Readonly<Record<string, unknown>>;
}): boolean {
  const value = span.attributes[GATEWAY_VIRTUAL_KEY_ID_ATTR];
  return typeof value === "string" && value.length > 0;
}

export interface GatewayBudgetDebitRecord {
  tenantId: string;
  traceId: string;
  virtualKeyId: string;
  gatewayRequestId: string;
  /** Fixed-point USD string for CH's `Decimal`. */
  amountUsd: string;
  tokensInput: number;
  tokensOutput: number;
  model: string;
  providerKey: string | null;
  status: GatewayBudgetLedgerStatus;
  durationMs: number;
  occurredAt: Date;
}

const LEDGER_DECIMAL_SCALE = 10;

export function formatLedgerDecimal(n: number): string {
  if (!Number.isFinite(n) || n < 0) return (0).toFixed(LEDGER_DECIMAL_SCALE);
  return n.toFixed(LEDGER_DECIMAL_SCALE);
}

export function deriveLedgerStatus(
  span: CanonicalSpan,
): GatewayBudgetLedgerStatus {
  return span.statusCode === "ERROR" ? "PROVIDER_ERROR" : "SUCCESS";
}

/**
 * Derive one gateway request's debit facts from the canonical span, or null
 * when it carries no gateway request id — the ledger's natural key, without
 * which a debit cannot be deduped against a replay.
 */
export function deriveGatewayDebitRecord(
  span: CanonicalSpan,
): GatewayBudgetDebitRecord | null {
  const virtualKeyId = span.attributes[GATEWAY_VIRTUAL_KEY_ID_ATTR];
  const gatewayRequestId = span.attributes[GATEWAY_REQUEST_ID_ATTR];
  if (typeof virtualKeyId !== "string" || virtualKeyId === "") return null;
  if (typeof gatewayRequestId !== "string" || gatewayRequestId === "") {
    return null;
  }

  const providerKey = span.attributes[GATEWAY_MODEL_PROVIDER_ID_ATTR];

  return {
    tenantId: span.tenantId,
    traceId: span.traceId,
    virtualKeyId,
    gatewayRequestId,
    amountUsd: formatLedgerDecimal(span.cost.cost ?? 0),
    tokensInput: span.usage.inputTokens ?? 0,
    tokensOutput: span.usage.outputTokens ?? 0,
    model: span.model ?? "unknown",
    providerKey:
      typeof providerKey === "string" && providerKey !== ""
        ? providerKey
        : null,
    status: deriveLedgerStatus(span),
    durationMs: Math.max(
      0,
      Math.round(span.endTimeUnixMs - span.startTimeUnixMs),
    ),
    occurredAt: new Date(span.startTimeUnixMs),
  };
}

export function createGatewayBudgetDebitsMap(deps: {
  store: AppendStore<GatewayBudgetDebitRecord>;
}): BuiltMap {
  return {
    name: "gatewayBudgetDebits",
    eventTypes: ["lw.obs.trace.span_received"],
    async apply(delivery) {
      const records: GatewayBudgetDebitRecord[] = [];
      for (const event of delivery.events as readonly WireEvent[]) {
        const span = event.data as CanonicalSpan;
        if (!spanCarriesGatewayVirtualKeyId(span)) continue;
        const record = deriveGatewayDebitRecord(span);
        if (record) records.push(record);
      }
      if (records.length === 0) return { written: 0 };
      await deps.store.writeBatch(records, {
        tenantId: delivery.tenantId,
        retentionDays: delivery.retentionDays,
      });
      return { written: records.length };
    },
  };
}
