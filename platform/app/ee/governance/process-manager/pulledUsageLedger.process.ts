// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { PULLED_USAGE_EVENT_TYPES } from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/constants";
import type {
  PulledUsageObservedEventData,
  PulledUsageProcessingEvent,
  PulledUsageRetractedEventData,
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
 * It remembers exactly one thing: the rollup cell this charge was last filed
 * in. Nothing about writing the ledger needs it — a pulled record is already
 * whole when it is minted, priced and attributed and timestamped, so the
 * ledger write has nothing to wait for. It is remembered because NOTHING ELSE
 * CAN. The restatement key deliberately excludes the currency, the agent and
 * the spender, so a provider reissuing one charge under any of those files it
 * in a different rollup cell and leaves the first version standing with its
 * money; a total across the day then carries the one bill twice. Recognising
 * that needs the previous cell and the new one side by side, and this is the
 * only place both are ever in scope: the aggregate is the restatement key, so
 * every version of one charge runs through this one instance, in order.
 *
 * The projection cannot do it — a fold sees one cell, never the pair, and a
 * projection that emitted would write into the log it is rebuilt from. The
 * puller cannot do it — it holds the new figure and has never read the old
 * one. Neither is a layering objection; both are simply blind to the
 * comparison.
 *
 * This state is NOT reconstructible from the event log, and that is a real
 * cost rather than a hidden one. Losing the process store loses the memory of
 * where each charge sits, and the next pull of an already-corrected charge
 * finds nothing to compare against and withdraws nothing. That fails to the
 * defect this exists to fix, never past it: a forgotten charge is a
 * double-count nobody withdrew, not a withdrawal of money that was really
 * spent. It does not touch the rebuild invariant either, which binds
 * projection tables — this is not one.
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
  /**
   * SIGNED. A provider that credits or refunds a period reports it as a
   * negative figure, and the ledger has to take it or the charge it reverses
   * stands alone. Refusing it here would fail the intent's own schema and the
   * credit would die in the outbox after its retries, silently, while the
   * charge stayed on the customer's books. The quantities below stay
   * nonnegative: a negative count of tokens is not something that happened.
   */
  cost_nano_usd: z.number().int(),
  tokens_input: z.number().int().min(0).default(0),
  tokens_output: z.number().int().min(0).default(0),
  tokens_cache_read: z.number().int().min(0).default(0),
  tokens_cache_write: z.number().int().min(0).default(0),
  occurred_at_ms: z.number().int().positive(),
  observed_at_ms: z.number().int().positive(),
});
export type WritePulledUsagePayload = z.infer<typeof writePulledUsageSchema>;

/**
 * The withdrawal an intent carries, which is the SUPERSEDED cell's address.
 *
 * Defaulted on `writePulledUsageSchema`'s rule and for its reason: this is a
 * durable outbox row, read back by whatever build drains it.
 *
 * `model` rides along without being compared. It is part of the cell's
 * address, so a withdrawal that omitted it would empty the wrong cell — but a
 * charge whose model alone changed is NOT a reissue, and the comparison below
 * is what draws that line.
 */
export const retractPulledUsageSchema = z.object({
  restatement_key: z.string(),
  /** The org's hidden governance project — the storage partition. */
  tenant_id: z.string(),
  organization_id: z.string(),
  source: z.string(),
  ingestion_source_id: z.string(),
  /** The superseded cell's address. Every field of it, stated. */
  model: z.string().default(""),
  currency_code: z.string().default("USD"),
  agent_id: z.string().default(""),
  raw_actor_id: z.string().default(""),
  /** The day this CORRECTS, never the day the correction arrived. */
  occurred_at_ms: z.number().int().positive(),
  /** When the superseding pull happened. The ordering field. */
  observed_at_ms: z.number().int().positive(),
});

export type RetractPulledUsagePayload = z.infer<
  typeof retractPulledUsageSchema
>;

/**
 * Where one charge is filed: the parts of its rollup cell that can move while
 * its restatement key stays the same.
 *
 * The rest of the cell's address cannot move for a given key — the tenant, the
 * day, the source and the ingestion source are all fixed by the key itself or
 * by the period it names — so remembering them would remember a constant.
 */
interface FiledCell {
  model: string;
  currencyCode: string;
  agentId: string;
  rawActorId: string;
  /**
   * The day the superseded version sat in. Carried rather than taken from the
   * new observation: it is the retraction's `occurredAtMs`, and that field
   * dates the withdrawal to the day it CORRECTS.
   */
  occurredAtMs: number;
}

export interface PulledUsageLedgerState {
  /** Null until this charge's first observation. */
  filedCell: FiledCell | null;
}

export const INITIAL_PULLED_USAGE_LEDGER_STATE: PulledUsageLedgerState = {
  filedCell: null,
};

/**
 * Whether a charge has been reissued into a different cell.
 *
 * The currency, the agent and the spender, and deliberately NOT the model.
 * Those three are exactly what the restatement key excludes, so a change in
 * any of them means one charge now occupies two cells. The model is excluded
 * for the opposite reason: an adapter that does not list the model among its
 * dimensions gives every model of one period the SAME restatement key, so a
 * second model arriving is ordinary spend rather than a correction, and
 * withdrawing on it would zero money that was really spent. That failure is
 * strictly worse than the double-count this whole path exists to prevent —
 * a missing withdrawal overstates a bill, a wrong one destroys a record of
 * money the customer actually paid.
 */
function isReissuedElsewhere(
  filed: FiledCell,
  next: Pick<
    PulledUsageObservedEventData,
    "currencyCode" | "agentId" | "rawActorId"
  >,
): boolean {
  return (
    filed.currencyCode !== next.currencyCode ||
    filed.agentId !== next.agentId ||
    filed.rawActorId !== next.rawActorId
  );
}

export interface PulledUsageLedgerProcessDeps {
  budgetCHRepository: GatewayBudgetClickHouseRepository;
  /**
   * Injected lazily so the process manager can be registered while the
   * pipeline that owns the command is still being built — the same reason
   * `spendSettlement` takes its send this way.
   */
  sendRetractPulledUsage: (
    data: PulledUsageRetractedEventData,
  ) => Promise<void>;
  /**
   * Read at EMIT time, per organization, never cached across a run. A kill
   * switch consulted when the process manager was registered would still be
   * emitting withdrawals long after somebody turned it off, which is the one
   * thing a kill switch is for.
   */
  retractionEnabled: (organizationId: string) => Promise<boolean>;
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

/**
 * Withdraws the superseded version, behind the outbox lease.
 *
 * Here rather than in the wake handler because a wake handler must be pure and
 * synchronous — the commit that persists the evolution is what fences racing
 * workers — so the flag read and the send run as an intent, on
 * `spendSettlement`'s precedent.
 *
 * `costNanoMinor` is stated as zero rather than omitted, and that is
 * load-bearing: the read path falls back to reading the amount out of
 * `costNanoUsd` in dollars when it is absent, so a withdrawal that omitted it
 * would address the DOLLAR cell and leave the euro one live — the exact
 * double-count this is here to end.
 *
 * Rethrown on failure so the outbox retries. A withdrawal that is dropped
 * leaves two live versions of one charge, which is money reported twice.
 */
export function runRetractPulledUsage(deps: PulledUsageLedgerProcessDeps) {
  return async (payload: RetractPulledUsagePayload): Promise<void> => {
    if (!(await deps.retractionEnabled(payload.organization_id))) {
      logger.info(
        {
          restatementKey: payload.restatement_key,
          organizationId: payload.organization_id,
        },
        "pulled usage reissue detected but withdrawal is disabled; the superseded version is left standing",
      );
      return;
    }

    logger.info(
      {
        restatementKey: payload.restatement_key,
        source: payload.source,
        retractedCurrencyCode: payload.currency_code,
        retractedAgentId: payload.agent_id,
        retractedRawActorId: payload.raw_actor_id,
        retractedModel: payload.model,
        observedAtMs: payload.observed_at_ms,
      },
      "withdrawing a pulled usage version superseded by a reissue",
    );

    await deps.sendRetractPulledUsage({
      restatementKey: payload.restatement_key,
      source: payload.source,
      ingestionSourceId: payload.ingestion_source_id,
      organizationId: payload.organization_id,
      model: payload.model,
      costNanoMinor: 0,
      currencyCode: payload.currency_code,
      costNanoUsd: null,
      rawActorId: payload.raw_actor_id,
      agentId: payload.agent_id,
      occurredAtMs: payload.occurred_at_ms,
      observedAtMs: payload.observed_at_ms,
    });
  };
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
 * Where the charge sits NOW, which is what the next version is compared
 * against. Recording where it FIRST landed instead would name a cell the first
 * correction already emptied, so every later pull would withdraw from nothing
 * while the middle version stayed live.
 */
function filedCellFor(record: PulledUsageObservedEventData): FiledCell {
  return {
    model: record.model,
    currencyCode: record.currencyCode,
    agentId: record.agentId,
    rawActorId: record.rawActorId,
    occurredAtMs: record.occurredAtMs,
  };
}

/**
 * The withdrawal, addressed to the SUPERSEDED cell.
 *
 * Every address field comes from `filed` rather than from the observation that
 * triggered it: the point is to empty where the charge used to sit, and the new
 * observation names where it sits now. Only `observedAtMs` is the new pull's,
 * because that is the ordering field.
 */
function retractionPayloadFor(
  filed: FiledCell,
  record: PulledUsageObservedEventData,
  tenantId: string,
): RetractPulledUsagePayload {
  return {
    restatement_key: record.restatementKey,
    tenant_id: tenantId,
    organization_id: record.organizationId,
    source: record.source,
    ingestion_source_id: record.ingestionSourceId,
    model: filed.model,
    currency_code: filed.currencyCode,
    agent_id: filed.agentId,
    raw_actor_id: filed.rawActorId,
    occurred_at_ms: filed.occurredAtMs,
    observed_at_ms: record.observedAtMs,
  };
}

/** The ledger row for this observation, in nano-dollars. */
function writePayloadFor(
  record: PulledUsageObservedEventData,
  costNanoUsd: number,
  tenantId: string,
): WritePulledUsagePayload {
  return {
    restatement_key: record.restatementKey,
    tenant_id: tenantId,
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
  };
}

/**
 * One instance per usage item. The event is already whole, so the handler
 * freezes exactly one deterministic write intent. The only state it keeps is
 * the cell the charge was last filed in, so a later pull that moves the same
 * charge elsewhere can withdraw the version it leaves behind.
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
      .state<PulledUsageLedgerState>(INITIAL_PULLED_USAGE_LEDGER_STATE)
      .intent(
        "writePulledUsage",
        writePulledUsageSchema,
        runWritePulledUsage(deps),
      )
      .intent(
        "retractPulledUsage",
        retractPulledUsageSchema,
        runRetractPulledUsage(deps),
      )
      .on(PULLED_USAGE_EVENT_TYPES.OBSERVED, (state, data, ctx) => {
        const record = data as PulledUsageObservedEventData;

        // Detection first, and deliberately BEFORE the unpriced-currency
        // return below. The reissue that matters most is a bill re-denominated
        // into another currency, and that is exactly the observation the
        // ledger has no dollar figure for — returning early on it would blind
        // the detector to its own headline case.
        // `?? null`: instances persisted before this state carried a
        // `filedCell` hold `{}`, and the runtime hands stored state back
        // verbatim rather than merging it over the initial state. Such a row
        // has never filed a cell we can name, so it is treated exactly like a
        // first observation. The price is the lost-process-store degradation
        // described in the file header: a reissue seen on that first
        // post-fix observation is not withdrawn, and that day carries the
        // charge twice until the next correction.
        const filed = state.filedCell ?? null;
        const reissued = filed !== null && isReissuedElsewhere(filed, record);
        const intents = reissued
          ? [
              ctx.intents.retractPulledUsage(
                `retract:${record.observedAtMs}`,
                retractionPayloadFor(filed, record, ctx.projectId),
              ),
            ]
          : [];

        const nextState: PulledUsageLedgerState = {
          filedCell: filedCellFor(record),
        };

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
          return { state: nextState, intents };
        }
        return {
          state: nextState,
          intents: [
            ...intents,
            ctx.intents.writePulledUsage(
              `pulled:${record.observedAtMs}`,
              writePayloadFor(record, costNanoUsd, ctx.projectId),
            ),
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
