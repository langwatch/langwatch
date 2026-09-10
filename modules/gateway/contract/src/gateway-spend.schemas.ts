/**
 * Spend-event filter vocabulary and row shape shared by every reader of the
 * `gateway_spend` ledger: the tRPC page read, the REST events and rollup
 * reads, and the repositories underneath them. One module owns the query
 * shape and the domain type so the screen and a reconciliation script cannot
 * come to mean something different by the same narrowing.
 */
import { z } from "zod";
import type { Instant } from "@langwatch/time";

export type SpendEventStatus = "admitted" | "confirmed" | "failed" | "settled";

/**
 * Every status a caller may narrow on. `success` and `error` are the pre-
 * pipeline spelling of `confirmed` and `failed`, kept so older clients keep
 * working.
 */
export const SPEND_STATUS_FILTERS = [
  "success",
  "error",
  "admitted",
  "confirmed",
  "failed",
  "settled",
] as const;

/** The events read's status filter: the whole vocabulary. */
export const spendStatusFilter = z.enum(SPEND_STATUS_FILTERS);

/**
 * Max values one filter may name - each becomes a bound ClickHouse array
 * element, so an unbounded repeat is an unbounded query on a billing read.
 * A caller needing more is really naming a team or organization instead.
 */
export const MAX_FILTER_VALUES = 100;

/** A metadata predicate: the caller's own key, and the values that match. */
export interface SpendMetadataFilter {
  key: string;
  /** Any of these matches. Repeating a key in the query widens it. */
  values: string[];
}

export interface SpendFilters {
  virtualKeyIds?: string[];
  endUserIds?: string[];
  principalUserIds?: string[];
  models?: string[];
  providerKeys?: string[];
  requestTypes?: string[];
  labels?: string[];
  metadata?: SpendMetadataFilter[];
  status?: string;
}

const id = z.string().min(1).max(100);
const longId = z.string().min(1).max(256);

/**
 * The structured spelling of the spend-event filter vocabulary, for a caller
 * that already speaks structured values rather than query strings - the
 * tRPC surface, so the Billing events screen narrows exactly the way the
 * REST reads do.
 */
export const spendFiltersSchema = z.object({
  virtualKeyIds: z.array(id).max(MAX_FILTER_VALUES).optional(),
  endUserIds: z.array(longId).max(MAX_FILTER_VALUES).optional(),
  principalUserIds: z.array(id).max(MAX_FILTER_VALUES).optional(),
  models: z.array(z.string().min(1).max(200)).max(MAX_FILTER_VALUES).optional(),
  providerKeys: z.array(id).max(MAX_FILTER_VALUES).optional(),
  requestTypes: z.array(z.string().min(1).max(50)).max(MAX_FILTER_VALUES).optional(),
  labels: z.array(z.string().min(1).max(200)).max(MAX_FILTER_VALUES).optional(),
  metadata: z
    .array(
      z.object({
        // No colon, so this spelling cannot express a key the query spelling
        // cannot. A filter the screen can set and a reconciliation script
        // cannot reproduce is the drift this whole module exists to prevent.
        key: z
          .string()
          .min(1)
          .max(128)
          .refine((raw) => !raw.includes(":"), {
            message: "a metadata key cannot contain a colon",
          }),
        // Non-empty for the same reason the query spelling is: ClickHouse
        // answers a missing Map key with the type default, so an empty value
        // matches every row that lacks the key.
        values: z.array(z.string().min(1).max(512)).min(1).max(MAX_FILTER_VALUES),
      }),
    )
    .max(MAX_FILTER_VALUES)
    .optional(),
  // The whole vocabulary, because this schema backs an EVENTS read. A rollup
  // caller narrows with the summary status filter instead.
  status: spendStatusFilter.optional(),
}) satisfies z.ZodType<SpendFilters>;

/** One spend-event row, as the ledger and its repositories carry it. */
export type SpendEventRow = {
  tenantId: string;
  gatewayRequestId: string;
  organizationId: string;
  /** Not carried by the command pipeline; kept for response-shape
   *  stability, always empty. */
  teamId: string;
  virtualKeyId: string;
  principalUserId: string;
  endUserId: string;
  traceId: string;
  model: string;
  providerKey: string;
  requestType: string;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  tokensReasoning: number;
  /** Integer nano-USD, the authoritative figure. */
  costNanoUsd: number;
  /** Decimal USD string derived from costNanoUsd, up to 9 fractional digits. */
  costUsd: string;
  rateVersion: string;
  status: SpendEventStatus;
  errorClass: string;
  httpStatus: number;
  needsReconciliation: boolean;
  /** Why settlement fired, set only on settled rows. */
  settleReason: string;
  labels: string[];
  metadata: string;
  durationMs: number;
  occurredAt: Instant;
};
