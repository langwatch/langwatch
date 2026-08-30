// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { PULLED_USAGE_EVENT_TYPES } from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/constants";
import type {
  PulledUsageObservedEventData,
  PulledUsageProcessingEvent,
} from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/events";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type { ProcessManagerApplier } from "~/server/event-sourcing/pipeline/processBuilder";
import type { JsonValue } from "~/server/event-sourcing/process-manager/json";
import type { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";

const logger = createLogger("langwatch:governance:pulled-usage-ledger");

/** The registered process name. Instance, inbox and outbox rows key on it. */
export const PULLED_USAGE_LEDGER_PROCESS_NAME = "pulledUsageLedger" as const;

/**
 * The sole writer of pulled provider cost into the shared usage ledger
 * (ADR-088).
 *
 * One instance per usage ITEM, because the aggregate is the restatement key:
 * every version of one provider bucket runs through the same instance, in
 * order. That is what makes "newest wins" a property of the stream rather than
 * a race between two writers.
 *
 * It carries no state, and that is the point rather than an omission. The
 * gateway's debit process manager has to join an admission to an outcome
 * because the price and the attribution arrive in different events; a pulled
 * record is already whole when it is minted — priced, attributed, timestamped
 * — so there is nothing to wait for and nothing to remember.
 *
 * What it deliberately does NOT do: resolve budgets, detect threshold
 * crossings, or emit BUDGET_UPDATED. Money spent outside the gateway cannot be
 * blocked and must not move an enforcement decision, so none of the machinery
 * that exists to move one is wired here. The absence is the invariant.
 */

/**
 * Every field carries a default where one is possible. An intent is a durable
 * outbox row, so a payload written by the previous build is read back by this
 * one, and a field without a default turns that row into a permanent parse
 * failure instead of a cost record.
 */
export const writePulledUsageSchema = z.object({
  restatement_key: z.string(),
  /** The org's hidden governance project — the storage partition. */
  tenant_id: z.string(),
  /** Who the money belongs to: the source's team, or its organization. */
  scope_id: z.string(),
  organization_id: z.string(),
  team_id: z.string().nullable().default(null),
  model: z.string().default(""),
  cost_nano_usd: z.number().int().min(0),
  tokens_input: z.number().int().min(0).default(0),
  tokens_output: z.number().int().min(0).default(0),
  tokens_cache_read: z.number().int().min(0).default(0),
  tokens_cache_write: z.number().int().min(0).default(0),
  occurred_at_ms: z.number().int().positive(),
  observed_at_ms: z.number().int().positive(),
});
export type WritePulledUsagePayload = z.infer<typeof writePulledUsageSchema>;

export interface PulledUsageLedgerProcessDeps {
  budgetCHRepository: GatewayBudgetClickHouseRepository;
}

/**
 * Where one pulled record's cost is filed.
 *
 * The team when the source has one, the organization otherwise. Never the
 * hidden governance project: that is the row's storage home (the ledger's
 * TenantId and the event's projectId, ADR-128), and a home is not an owner.
 * Filing a customer's money under a project they cannot see would make it
 * invisible in exactly the screens this whole ADR exists to populate.
 */
export function pulledUsageScopeId(
  record: Pick<PulledUsageObservedEventData, "organizationId" | "teamId">,
): string {
  return record.teamId ?? record.organizationId;
}

export function runWritePulledUsage(deps: PulledUsageLedgerProcessDeps) {
  return async (payload: WritePulledUsagePayload): Promise<void> => {
    try {
      await deps.budgetCHRepository.insertPulledUsageRows([
        {
          tenantId: payload.tenant_id,
          scopeId: payload.scope_id,
          restatementKey: payload.restatement_key,
          amountNanoUsd: payload.cost_nano_usd,
          tokensInput: payload.tokens_input,
          tokensOutput: payload.tokens_output,
          tokensCacheRead: payload.tokens_cache_read,
          tokensCacheWrite: payload.tokens_cache_write,
          model: payload.model,
          occurredAt: new Date(payload.occurred_at_ms),
          observedAt: new Date(payload.observed_at_ms),
        },
      ]);
    } catch (error) {
      logger.error(
        {
          tenantId: payload.tenant_id,
          scopeId: payload.scope_id,
          restatementKey: payload.restatement_key,
          error,
        },
        "failed to write pulled usage cost to the ledger",
      );
      // Rethrow for the outbox retry. A lost pulled row under-reports what a
      // customer spent, and unlike a lost debit nothing else will notice.
      throw error;
    }
  };
}

/** The currency the dollar ledger is denominated in. */
const LEDGER_CURRENCY_CODE = "USD";

/**
 * What this item is worth in the ledger's dollars, or null when nobody can say.
 *
 * An item billed in dollars needs no conversion — the amount IS the dollar
 * amount. An item billed in anything else can only be stated in dollars by the
 * biller, and we never invent a rate to stand in for one it did not publish.
 */
function ledgerAmountNanoUsd(
  record: PulledUsageObservedEventData,
): number | null {
  if (record.currencyCode === LEDGER_CURRENCY_CODE) return record.costNanoMinor;
  return record.costNanoUsd;
}

/**
 * One instance per usage item. The event is already whole, so the handler
 * freezes exactly one deterministic write intent and keeps no state.
 *
 * The intent key is the restatement key plus the observation instant, which is
 * what keeps a correction from colliding with the figure it corrects: two
 * versions of one bucket are two intents, ordered, and the ledger's own
 * version column decides which one the read sees.
 */
export function pulledUsageLedgerPM(
  deps: PulledUsageLedgerProcessDeps,
): ProcessManagerApplier<PulledUsageProcessingEvent> {
  return (pm) =>
    pm
      .state({})
      .intent(
        "writePulledUsage",
        writePulledUsageSchema,
        runWritePulledUsage(deps),
      )
      .on(PULLED_USAGE_EVENT_TYPES.OBSERVED, (state, data, ctx) => {
        const record = data as PulledUsageObservedEventData;
        const costNanoUsd = ledgerAmountNanoUsd(record);
        // The ledger column is nano-DOLLARS. An item billed in another
        // currency that the biller published no conversion for has no honest
        // value to put in it: writing the native figure would file euros as
        // dollars, and writing 0 would report real spend as free. It gets no
        // ledger row, and the daily rollup — which keys by currency and keeps
        // the full amount — is where that money is read (ADR-128 §3).
        if (costNanoUsd === null) {
          logger.warn(
            {
              restatementKey: record.restatementKey,
              source: record.source,
              currencyCode: record.currencyCode,
            },
            "pulled usage is in a currency the biller published no dollar figure for; it is summarized but not written to the dollar ledger",
          );
          return { state, intents: [] };
        }
        return {
          state,
          intents: [
            ctx.intents.writePulledUsage(`pulled:${record.observedAtMs}`, {
              restatement_key: record.restatementKey,
              tenant_id: ctx.projectId,
              scope_id: pulledUsageScopeId(record),
              organization_id: record.organizationId,
              team_id: record.teamId,
              model: record.model,
              cost_nano_usd: costNanoUsd,
              tokens_input: record.tokensInput,
              tokens_output: record.tokensOutput,
              tokens_cache_read: record.tokensCacheRead,
              tokens_cache_write: record.tokensCacheWrite,
              occurred_at_ms: record.occurredAtMs,
              observed_at_ms: record.observedAtMs,
            } satisfies WritePulledUsagePayload),
          ],
        };
      })
      .toPayload((event) => event.data as unknown as JsonValue)
      .outbox({
        maxAttempts: 8,
        concurrency: 4,
        batchSize: 8,
        leaseDurationMs: 120_000,
      });
}
