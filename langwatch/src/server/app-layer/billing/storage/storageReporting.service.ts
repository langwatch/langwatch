import { createLogger } from "~/utils/logger/server";
import type { StorageBillingCheckpointRepository } from "./repositories/storage-billing-checkpoint.repository";
import type { StorageUsageHourlyRepository } from "./repositories/storage-usage-hourly.repository";
import { MS_PER_HOUR } from "./sealedHour";

const logger = createLogger("langwatch:billing:storageReporting");

/** Stripe `sum` meter this reporter feeds (kept contract, ADR-039 Decision 2). */
export const STORAGE_METER_EVENT_NAME = "langwatch_storage_megabytes_hourly";

/**
 * Stripe rejects meter events whose timestamp is older than ~35 days. Hours
 * beyond it are settled WITHOUT reporting and alerted — dropping them
 * silently would be unmetered usage nobody ever sees (the
 * meterEventAdjustments runbook owns anything bigger).
 */
export const STRIPE_BACKDATE_CEILING_HOURS = 840;

/** Most hours settled for one org in one run; the backlog drains across sweeps. */
export const REPORT_MAX_HOURS_PER_RUN = 200;

/** Consecutive Stripe failures before the breaker alarm fires. */
export const MAX_CONSECUTIVE_REPORT_FAILURES = 5;

/**
 * Safety margin under the ceiling: a row passing the gate at sweep start
 * must still be inside Stripe's server-side cutoff after up to 200 awaited
 * sends — a row this close to the edge is settled+alerted instead of
 * gambled at the API.
 */
export const BACKDATE_SAFETY_MARGIN_HOURS = 24;

export interface StorageReportingDeps {
  usageHourly: StorageUsageHourlyRepository;
  checkpoints: StorageBillingCheckpointRepository;
  /** The MONEY gate: release_storage_boundary_billing, per org, default OFF. */
  isBillingEnabled: (organizationId: string) => Promise<boolean>;
  getBillableOrg: (organizationId: string) => Promise<{
    stripeCustomerId: string | null;
    subscriptions: { id: string }[];
  } | null>;
  /**
   * Sends one additive meter event, CLASSIFIED:
   * - "sent": delivered.
   * - "duplicate": Stripe already has this identifier
   *   (resource_already_exists) — success, the idempotency key did its job.
   * - "permanent-reject": Stripe will never accept this event (invalid
   *   request other than duplicate, auth) — retrying forever would wedge
   *   the org's queue behind a poison row.
   * Throws ONLY on genuinely transient failures (network, 5xx, rate limit).
   */
  sendMeterEvent: (params: {
    stripeCustomerId: string;
    organizationId: string;
    value: number;
    identifier: string;
    /** Unix seconds. */
    timestamp: number;
  }) => Promise<{ outcome: "sent" | "duplicate" | "permanent-reject" }>;
  /** Alert sink: backdate skips, permanent rejects, and breaker trips. */
  onReportingAlert: (params: {
    organizationId: string;
    kind: "backdate-ceiling" | "permanent-reject" | "circuit-breaker";
    detail: Record<string, string>;
  }) => void;
}

/**
 * The reporter (ADR-039 Decision 2, kept protocol): consumes unreported
 * StorageUsageHourly rows oldest-first with an idempotent per-hour cursor
 * (`reportedAt`), a deterministic Stripe identifier per (org, hour), and
 * additive delivery into a `sum` meter — every invoice line traces back to
 * hourly rows, and re-dispatch/crash-resume can never double-bill.
 *
 * Zero-usage hours are settled without a Stripe call. A transient Stripe
 * failure leaves the hour unreported (the next sweep retries) and stops the
 * org's run — hours must land oldest-first for the backdate ceiling to stay
 * meaningful. Repeated failures trip the breaker alarm.
 */
export class StorageReportingService {
  constructor(private readonly deps: StorageReportingDeps) {}

  async reportForOrg({
    organizationId,
    at,
  }: {
    organizationId: string;
    at: Date;
  }): Promise<void> {
    if (!(await this.deps.isBillingEnabled(organizationId))) return;

    // Known gap (deliberate, tracked in the ADR's open questions): an org
    // that cancels leaves its final unreported hours behind this gate —
    // they never reach Stripe and never alarm. Departing customers' last
    // partial period is under-billed until a subscription-end flush exists.
    const org = await this.deps.getBillableOrg(organizationId);
    if (!org?.stripeCustomerId || org.subscriptions.length === 0) return;

    const rows = await this.deps.usageHourly.findUnreportedHours({
      organizationId,
      limit: REPORT_MAX_HOURS_PER_RUN,
    });
    if (rows.length === 0) return;

    const earliestReportableMs =
      at.getTime() -
      (STRIPE_BACKDATE_CEILING_HOURS - BACKDATE_SAFETY_MARGIN_HOURS) *
        MS_PER_HOUR;

    for (const row of rows) {
      // Zero usage: settle the cursor, never call Stripe.
      if (row.megabytes === 0) {
        await this.deps.usageHourly.markReported({
          organizationId,
          sealedHour: row.sealedHour,
          reportedAt: at,
        });
        continue;
      }

      // Past Stripe's backdate ceiling: settle so the queue can't wedge on
      // an unreportable hour, and ALERT — this is usage that will never be
      // metered without the meterEventAdjustments runbook.
      if (row.sealedHour.getTime() < earliestReportableMs) {
        logger.error(
          {
            organizationId,
            sealedHour: row.sealedHour,
            megabytes: row.megabytes,
          },
          "ALARM: storage hour is older than the Stripe backdate ceiling — " +
            "settled WITHOUT reporting; recover via meterEventAdjustments",
        );
        this.deps.onReportingAlert({
          organizationId,
          kind: "backdate-ceiling",
          detail: {
            sealedHour: row.sealedHour.toISOString(),
            megabytes: String(row.megabytes),
          },
        });
        await this.deps.usageHourly.markReported({
          organizationId,
          sealedHour: row.sealedHour,
          reportedAt: at,
        });
        continue;
      }

      const billingMonth = row.sealedHour.toISOString().slice(0, 7);
      try {
        const { outcome } = await this.deps.sendMeterEvent({
          stripeCustomerId: org.stripeCustomerId,
          organizationId,
          value: row.megabytes,
          identifier: buildStorageMeterIdentifier({
            organizationId,
            sealedHour: row.sealedHour,
          }),
          timestamp: Math.floor(row.sealedHour.getTime() / 1000),
        });
        if (outcome === "permanent-reject") {
          // Stripe will NEVER accept this event: settle it (a poison row
          // must not block every newer hour forever) and alert — this is
          // usage that needs the meterEventAdjustments runbook.
          logger.error(
            {
              organizationId,
              sealedHour: row.sealedHour,
              megabytes: row.megabytes,
            },
            "ALARM: Stripe permanently rejected a storage meter event — " +
              "settled WITHOUT reporting; recover via meterEventAdjustments",
          );
          this.deps.onReportingAlert({
            organizationId,
            kind: "permanent-reject",
            detail: {
              sealedHour: row.sealedHour.toISOString(),
              megabytes: String(row.megabytes),
            },
          });
        }
        await this.deps.usageHourly.markReported({
          organizationId,
          sealedHour: row.sealedHour,
          reportedAt: at,
        });
        await this.deps.checkpoints.resetFailures({
          organizationId,
          billingMonth,
        });
      } catch (error) {
        // The hour stays unreported — the next sweep retries with the SAME
        // deterministic identifier, so even a sent-but-unconfirmed event
        // cannot double-bill.
        const { consecutiveFailures } =
          await this.deps.checkpoints.recordFailure({
            organizationId,
            billingMonth,
          });
        logger.warn(
          {
            organizationId,
            sealedHour: row.sealedHour,
            error,
            consecutiveFailures,
          },
          "storage meter event failed; hour left unreported for retry",
        );
        if (consecutiveFailures >= MAX_CONSECUTIVE_REPORT_FAILURES) {
          logger.error(
            { organizationId, billingMonth, consecutiveFailures },
            "ALARM: storage reporting circuit-breaker tripped",
          );
          this.deps.onReportingAlert({
            organizationId,
            kind: "circuit-breaker",
            detail: {
              billingMonth,
              consecutiveFailures: String(consecutiveFailures),
            },
          });
        }
        // Stop this org's run: hours must settle oldest-first.
        return;
      }
    }
  }
}

/** Deterministic per-(org, hour) Stripe idempotency key (kept contract). */
export function buildStorageMeterIdentifier({
  organizationId,
  sealedHour,
}: {
  organizationId: string;
  sealedHour: Date;
}): string {
  // Hour precision: "storage_mb:org_x:2026-07-10T14"
  return `storage_mb:${organizationId}:${sealedHour.toISOString().slice(0, 13)}`;
}
