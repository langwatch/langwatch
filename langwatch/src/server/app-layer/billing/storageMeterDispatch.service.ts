import type { ReportStorageForHourCommandData } from "~/server/event-sourcing/pipelines/billing-reporting/schemas/commands";
import { createLogger } from "~/utils/logger/server";
import type { StorageUsageHourlyRepository } from "./storageUsageHourly.repository";

const logger = createLogger("langwatch:billing:storageMeterDispatch");

const MS_PER_HOUR = 60 * 60 * 1000;
const BYTES_PER_MIB = 1024 * 1024;

/**
 * Stripe rejects meter events whose timestamp is older than ~35 days, so the
 * gap-fill never reaches back further than this. A longer outage needs the
 * `meterEventAdjustments.create` runbook; truncating here is alarmed, never
 * silent (see {@link StorageMeterDispatchService.dispatchForOrg}).
 */
export const STORAGE_BACKFILL_MAX_HOURS = 840;

/** Narrow contracts so the service depends on capabilities, not whole services. */
export interface StorageMeterDispatchDeps {
  isMeteringEnabled: (organizationId: string) => Promise<boolean>;
  getBillableOrg: (organizationId: string) => Promise<{
    stripeCustomerId: string | null;
    subscriptions: { id: string }[];
  } | null>;
  measureBytesAt: (params: {
    organizationId: string;
    sealedHour: Date;
  }) => Promise<number>;
  storageUsageHourly: StorageUsageHourlyRepository;
  enqueueReport: (data: ReportStorageForHourCommandData) => Promise<void>;
  /**
   * Runs `fn` at most once per organization at a time. The reactor dedups per
   * PROJECT, so an org with several active projects would otherwise gap-fill —
   * and re-run the heavy `byteSize()` measurement (the two-prod-OOM operation) —
   * once per project for the same hours. This collapses that to one dispatch per
   * org: if the guard is already held for the org, `fn` is skipped (the holder
   * covers every sealed hour). When omitted (no Redis), `fn` runs directly.
   */
  runExclusivePerOrg?: (
    organizationId: string,
    fn: () => Promise<void>,
  ) => Promise<void>;
  /**
   * Optional measure-time drift guard (ADR-027 Phase 4.5). Observational only —
   * its `check` never throws and never alters the billed value.
   */
  tripwire?: {
    check: (params: {
      organizationId: string;
      sealedHour: Date;
      measuredBytes: number;
    }) => Promise<void>;
  };
  /** Injectable wall clock for deterministic tests. */
  now?: () => Date;
}

/** Floor a timestamp to the start of its UTC hour. */
function floorToHourMs(ms: number): number {
  return Math.floor(ms / MS_PER_HOUR) * MS_PER_HOUR;
}

/**
 * Advances an organization's hourly storage cursor: for every sealed hour not
 * yet measured (up to the last complete wall-clock hour), measures the billable
 * bytes, persists a `StorageUsageHourly` row, and enqueues a report command.
 *
 * Stateless: the cursor is read from the durable table each run
 * ({@link StorageUsageHourlyRepository.getLastMeasuredHour}), so it survives
 * restarts and stays correct across pods without in-memory state. The reactor
 * that calls this is per-project deduped (300s), so the per-run DB read is
 * cheap. Idempotent end-to-end — `recordHour` is insert-if-absent and the
 * report command dedups on its own cursor — so a re-fire never double-counts.
 *
 * Gated by the `release_storage_billing_metering` flag (default OFF, checked via
 * the injected `isMeteringEnabled`): disabled → zero CH queries, zero rows, zero
 * enqueues. SaaS short-circuit runs before any measurement.
 */
export class StorageMeterDispatchService {
  constructor(private readonly deps: StorageMeterDispatchDeps) {}

  async dispatchForOrg({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<void> {
    // 1. Master flag gate — OFF → fully inert (no CH, no rows, no enqueue).
    if (!(await this.deps.isMeteringEnabled(organizationId))) return;

    // 2. SaaS short-circuit BEFORE any ClickHouse query: free / self-hosted /
    //    no-subscription orgs never enter the measurement loop.
    const org = await this.deps.getBillableOrg(organizationId);
    if (!org?.stripeCustomerId || org.subscriptions.length === 0) return;

    // 3. Collapse concurrent per-project dispatches for the same org to one, so
    //    the heavy measurement isn't re-run per project. The flag + SaaS checks
    //    above are cheap and run unguarded; only the measurement work is guarded.
    const runExclusive = this.deps.runExclusivePerOrg ?? ((_org, fn) => fn());
    await runExclusive(organizationId, () => this.catchUp(organizationId));
  }

  /** Measures and enqueues every sealed hour not yet done for the org. */
  private async catchUp(organizationId: string): Promise<void> {
    // Window: catch up to the last COMPLETE wall-clock hour. The triggering
    // event is only a wake-up; what we measure is "sealed hours not yet done".
    const now = (this.deps.now ?? (() => new Date()))();
    const sealBoundaryMs = floorToHourMs(now.getTime()) - MS_PER_HOUR;

    const last = await this.deps.storageUsageHourly.getLastMeasuredHour({
      organizationId,
    });
    // No history → start at the latest sealed hour (forward-only; never backfill
    // a brand-new org's entire past). Otherwise resume after the last measured.
    let firstMs = last ? last.getTime() + MS_PER_HOUR : sealBoundaryMs;
    if (firstMs > sealBoundaryMs) return; // already caught up

    // 4. Bound the gap at Stripe's timestamp ceiling; alarm if hours are dropped.
    const earliestAllowedMs =
      sealBoundaryMs - (STORAGE_BACKFILL_MAX_HOURS - 1) * MS_PER_HOUR;
    if (firstMs < earliestAllowedMs) {
      logger.error(
        {
          organizationId,
          droppedHours: (earliestAllowedMs - firstMs) / MS_PER_HOUR,
          ceilingHours: STORAGE_BACKFILL_MAX_HOURS,
        },
        "ALARM: storage gap exceeds the backfill ceiling — older hours dropped, " +
          "they will never be metered without the meterEventAdjustments runbook.",
      );
      firstMs = earliestAllowedMs;
    }

    // 5. Measure → persist → enqueue, one sealed hour at a time. A measurement
    //    that throws aborts the loop (no silent under-bill); progress is durable
    //    per hour, so the next wake-up resumes from the last recorded hour.
    for (let ms = firstMs; ms <= sealBoundaryMs; ms += MS_PER_HOUR) {
      const sealedHour = new Date(ms);
      const bytes = await this.deps.measureBytesAt({
        organizationId,
        sealedHour,
      });
      // Observational drift guard — never throws, never changes the billed value.
      await this.deps.tripwire?.check({
        organizationId,
        sealedHour,
        measuredBytes: bytes,
      });
      const megabytes = Math.ceil(bytes / BYTES_PER_MIB);

      await this.deps.storageUsageHourly.recordHour({
        organizationId,
        sealedHour,
        megabytes,
      });
      await this.deps.enqueueReport({
        organizationId,
        sealedHour: sealedHour.toISOString(),
        tenantId: organizationId,
        occurredAt: now.getTime(),
      });
    }
  }
}
