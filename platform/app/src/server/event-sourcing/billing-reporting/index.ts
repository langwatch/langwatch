/**
 * The billing-reporting pipeline (ADR-098, ADR-099, ADR-100, ADR-102,
 * ADR-105, ADR-106), rewritten onto `@langwatch/event-sourcing` and
 * `@langwatch/clickhouse` from `event-sourcing.old/pipelines/billing-reporting/`
 * (read-only reference; this is a rewrite of behaviour, not a port of code).
 *
 * @see specs/licensing/billing-meter-dispatch.feature — the contract.
 *
 * ## What this pipeline does
 *
 * Two independent triggers keep an organization's month total accurate:
 *
 *   - The **meter** (`meter/`) records every billable event — one row per
 *     event, deduplicated so a redelivery cannot double-bill — from the 4
 *     pipelines that produce billable usage.
 *   - The **poke** (`reporting/billingMeterPoke.ts`) reacts to a billable
 *     event landing and asks for that organization's current month to be
 *     re-read and reported. The fast path.
 *   - The **sweep** (`reporting/billingMeterSweep.ts`) re-reads and
 *     re-reports on an hourly clock regardless of whether anything poked.
 *     The guarantee: the only thing that recovers a poke whose dispatch
 *     failed every retry, and the only thing that catches an organization
 *     whose last billable event of the month is its last event ever.
 *   - **`reportUsageForMonth`** (`reporting/reportUsageForMonth.ts`) is what
 *     both triggers dispatch: it reads the month's meter total as a level,
 *     diffs it against a two-phase Postgres checkpoint, and reports the delta
 *     to Stripe.
 *
 * ## The two guarantees this rewrite must not regress
 *
 *   1. **The sweep is a SCHEDULED guarantee, not a per-event outbox.** It
 *      must run on its own clock, never depending on an event arriving.
 *      `runBillingMeterSweep` (`reporting/billingMeterSweep.ts`) is a plain
 *      function of "what time is it, and what do I owe" — nothing about it
 *      is keyed to any specific event's delivery.
 *   2. **`billable_events` is keyed on a deduplication hash, so a redelivery
 *      cannot double-bill.** The table's merge strategy is
 *      `ReplacingMergeTree(UpdatedAt)`, its identity leads with
 *      `DeduplicationKeyHash`, and the read side counts `countDistinct`
 *      rather than `count(*)` — see `meter/billableEventsTable.ts` and
 *      `meter/billableEventsMeter.mapProjection.ts`'s docblocks for exactly
 *      how the write path preserves this.
 *
 * A third correctness property was found and fixed during review, not
 * carried over from the reference implementation: the pre-rewrite
 * `reportUsageForMonth`'s failure counter could latch an organization out of
 * invoicing permanently (`getCheckpoint`'s `consecutiveFailures` gated the
 * Stripe attempt itself, and `confirm()` — the only place it resets — is
 * reachable only through a successful attempt). `reporting/
 * reportUsageForMonth.ts` never skips the attempt; only the immediate,
 * un-throttled self-dispatch retry pauses once tripped, so the next
 * independent poke or sweep tick keeps probing Stripe at a safe cadence and
 * recovers automatically. See that file's docblock.
 *
 * ## A significant, deliberate gap: no mounting runtime exists yet
 *
 * `@langwatch/event-sourcing`'s `src/index.ts` exports `defineAggregate`, the
 * fold and map executors, the store contracts, the dispatch-plane group-key
 * descriptor/renderer, and the schema compiler. It does **not** export (and,
 * checked directly against `src/`, does not yet implement) a pipeline
 * builder, an event-subscriber runtime, a process-manager runtime, a
 * command bus, or a scheduler — the primitives `event-sourcing.old`'s
 * `definePipeline().withCommandInstance()` / `.withProcessManager()` used to
 * mount the poke, the sweep and the command. Nor is `packages/event-sourcing/
 * src/mount/validateMount.ts` (ADR-106) re-exported, so this pipeline's mount
 * descriptors (documented in `meter/billableEventsMeter.mapProjection.ts`)
 * cannot be checked by the library today.
 *
 * This is not something this pipeline can paper over by inventing a fake
 * `definePipeline`-shaped API that doesn't exist in the package — that would
 * be guessing at an unimplemented surface, which is exactly what "rewrite,
 * don't port" and "stop and report rather than choosing" rule out. Instead:
 *
 *   - The **meter** is fully real: a working `AppendStore` (ADR-099) over a
 *     `defineTable` declaration, executed by `createMapExecutor` from
 *     `@langwatch/event-sourcing`. Nothing about it is a stub.
 *   - The **poke**, the **sweep** and **`reportUsageForMonth`** are complete,
 *     independently testable, plain functions with every business rule from
 *     the feature file preserved — the debounce/dedup shape a queue must
 *     apply is captured in `reporting/dispatchOptions.ts` so it is not lost,
 *     even though nothing here can enforce it yet.
 *   - `createBillingReportingPipeline` below assembles them into one object.
 *     It is deliberately not called a "pipeline" in the `event-sourcing.old`
 *     sense (no `.commands` / `.processManagers` maps) because that shape
 *     does not exist to build.
 *
 * Whoever wires the real mounts — a subscriber runtime, a process-manager
 * runtime or the existing generic `~/server/app-layer/scheduler/
 * scheduler.service.ts`, and the 4 source pipelines' own composition sites
 * for the poke — does so from outside this directory. `createPokeMount` and
 * `createSweepMount`'s docblocks say exactly what each expects.
 */

import type { ClickHouseClient } from "@langwatch/clickhouse";
import type { UsageReportingService } from "@ee/billing/services/usageReportingService";
import type { queryBillableEventsTotal as QueryBillableEventsTotalFn } from "@ee/billing/services/billableEventsQuery";
import type { BillingCheckpointService } from "~/server/app-layer/billing/billingCheckpoint.service";
import type { OrganizationService } from "~/server/app-layer/organizations/organization.service";
import { resolveOrganizationId as resolveOrganizationIdDefault } from "~/server/organizations/resolveOrganizationId";

import {
  BILLABLE_EVENT_TYPES,
  createBillableEventsMeterProjection,
} from "./meter/billableEventsMeter.mapProjection";
import { createBillableEventsMeterStore } from "./meter/billableEventsMeter.store";
import { billableEventsTable } from "./meter/billableEventsTable";
import {
  type BillingMeterPokeMount,
  createBillingMeterPokeMount,
} from "./reporting/billingMeterPoke";
import {
  type BillingMeterSweepDeps,
  type BillingMeterSweepMount,
  createBillingMeterSweepMount,
} from "./reporting/billingMeterSweep";
import { reportUsageForMonthDispatchOptions } from "./reporting/dispatchOptions";
import { type ReportUsageForMonthData, reportUsageForMonth } from "./reporting/reportUsageForMonth";

export { BILLING_GRACE_PERIOD_DAYS, BILLING_REPORTING_PIPELINE_NAME } from "./constants";
export { billableEventsTable } from "./meter/billableEventsTable";
export {
  BILLABLE_EVENT_TYPES,
  type BillableEventMeterRecord,
  type BillableSourceEvent,
  billableEventsMeterGroupKey,
  createBillableEventsMeterProjection,
  extractDeduplicationKey,
  mapBillableEvent,
  renderBillableEventsMeterGroupKey,
} from "./meter/billableEventsMeter.mapProjection";
export {
  type BillableEventsMeterStoreDeps,
  createBillableEventsMeterStore,
} from "./meter/billableEventsMeter.store";
export {
  type BillableEventForPoke,
  type BillingMeterPokeDeps,
  type BillingMeterPokeMount,
  billingMeterPokeDedupId,
  billingMeterPokeGroupKey,
  createBillingMeterPokeMount,
  handleBillableEventPoke,
} from "./reporting/billingMeterPoke";
export {
  BILLING_METER_SWEEP_NAME,
  type BillingMeterSweepDeps,
  type BillingMeterSweepMount,
  billingMonthsForSweep,
  createBillingMeterSweepMount,
  runBillingMeterSweep,
} from "./reporting/billingMeterSweep";
export {
  type ReportUsageForMonthDispatchOptions,
  reportUsageForMonthDispatchOptions,
  reportUsageForMonthGroupKey,
} from "./reporting/dispatchOptions";
export {
  type ReportUsageForMonthData,
  type ReportUsageForMonthDeps,
  reportUsageForMonth,
} from "./reporting/reportUsageForMonth";

export interface BillingReportingPipelineDeps {
  readonly organizations: Pick<OrganizationService, "getOrganizationForBilling">;
  readonly billingCheckpoints: BillingCheckpointService;
  /** Read per dispatch: usage reporting is SaaS-only, absent from a self-hosted build entirely. */
  readonly getUsageReportingService: () => UsageReportingService | undefined;
  readonly queryBillableEventsTotal: typeof QueryBillableEventsTotalFn;
  readonly resolveOrganizationId?: (projectId: string) => Promise<string | undefined>;
  /** See `meter/billableEventsMeter.store.ts`'s docblock for the known gap this port names. */
  readonly getClickHouseClientForOrganization: (
    organizationId: string,
  ) => Promise<ClickHouseClient | null>;
  readonly isSaas: boolean;
}

/**
 * Assembles the billing-reporting pipeline's pieces from their dependencies.
 * See this file's module docblock for what "assembles" does and does not mean
 * today.
 */
export function createBillingReportingPipeline(deps: BillingReportingPipelineDeps) {
  // Bound once so the poke, the sweep and the command's own convergence loop
  // all dispatch through the identical closure — there is exactly one
  // `reportUsageForMonth` in this pipeline, never a copy per caller.
  const dispatch = (data: ReportUsageForMonthData): Promise<void> =>
    reportUsageForMonth(data, {
      organizations: deps.organizations,
      billingCheckpoints: deps.billingCheckpoints,
      getUsageReportingService: deps.getUsageReportingService,
      queryBillableEventsTotal: deps.queryBillableEventsTotal,
      selfDispatch: (next) => dispatch(next),
    });

  return {
    meter: {
      table: billableEventsTable,
      eventTypes: BILLABLE_EVENT_TYPES,
      createStore: () =>
        createBillableEventsMeterStore({
          resolveOrganizationId: deps.resolveOrganizationId ?? resolveOrganizationIdDefault,
          getClickHouseClientForOrganization: deps.getClickHouseClientForOrganization,
        }),
      createProjection: (store: ReturnType<typeof createBillableEventsMeterStore>) =>
        createBillableEventsMeterProjection({ store }),
    },

    reportUsageForMonth: dispatch,
    dispatchOptions: reportUsageForMonthDispatchOptions,

    /**
     * Called once per source pipeline (trace, evaluation, experiment-run,
     * simulation processing), each with its own subset of
     * `BILLABLE_EVENT_TYPES` — the poke is mounted on all 4, and each mount's
     * `eventTypes` is only the slice that pipeline actually produces.
     */
    createPokeMount: (eventTypes: readonly string[]): BillingMeterPokeMount =>
      createBillingMeterPokeMount({
        eventTypes,
        isSaas: deps.isSaas,
        resolveOrganizationId: deps.resolveOrganizationId,
        dispatchReport: dispatch,
      }),

    /**
     * `listOrganizationsToReport` and `recordTick` are supplied by whoever
     * mounts this — `~/server/app-layer/billing/
     * billingReportingCandidates.service.ts` already implements the former
     * unchanged; the latter has no existing implementation (see
     * `reporting/billingMeterSweep.ts`'s `BillingMeterSweepDeps.recordTick`
     * docblock for why).
     */
    createSweepMount: (
      sweepDeps: Omit<BillingMeterSweepDeps, "dispatchReport">,
    ): BillingMeterSweepMount =>
      createBillingMeterSweepMount({ ...sweepDeps, dispatchReport: dispatch }),
  };
}
