import { createLogger } from "~/utils/logger/server";
import { foldBoundaryEvents } from "./gaugeFold";
import type { StorageBillableGaugeRepository } from "./repositories/storage-billable-gauge.repository";
import type { StorageBoundaryEventRepository } from "./repositories/storage-boundary-event.repository";
import type {
  HourlySample,
  StorageUsageHourlyRepository,
} from "./repositories/storage-usage-hourly.repository";
import { currentSealedHour, MS_PER_HOUR } from "./sealedHour";

const logger = createLogger("langwatch:billing:gaugeSampling");

export const BYTES_PER_MIB = 1024 * 1024;

/**
 * Most hours sampled in one run — bounds a post-outage catch-up burst; a
 * larger backlog drains across successive sweeps (kept from the
 * predecessor's review hardening).
 */
export const SAMPLE_CAP_HOURS_PER_RUN = 168;

/**
 * How far below zero the folded gauge may transiently dip before it stops
 * being ReplacingMergeTree merge noise and becomes a drift alarm. Initial
 * value; the reconciliation rollout owns tuning it (ADR-039 open question).
 */
export const NEGATIVE_DRIFT_TOLERANCE_BYTES = 100n * 1024n * 1024n; // 100 MiB

export interface GaugeSamplingDeps {
  events: StorageBoundaryEventRepository;
  gauge: StorageBillableGaugeRepository;
  usageHourly: StorageUsageHourlyRepository;
  /** Drift alarm sink — never auto-corrects, only surfaces (ADR-039 Decision 7). */
  onDriftAlarm: (params: {
    organizationId: string;
    sealedHour: Date;
    gaugeBytes: bigint;
  }) => void;
}

/**
 * Samples the gauge into StorageUsageHourly — always by ONE ordered
 * fold-to-H replay of the event log (ADR-039 Decision 4), never from the
 * live gauge row: an event that occurred after a missed hour must not leak
 * into that hour's value, so even the steady-state single-hour sample is a
 * replay cut at the hour boundary. O(events + hours) per run.
 *
 * The sampled value is clamped (`max(0, ceil(bytes/MiB))`) — a refused
 * sample is a silently dropped billing hour, worse than a clamped one — and
 * a gauge below the negative-drift tolerance raises the alarm while still
 * sampling zero.
 */
export class GaugeSamplingService {
  constructor(private readonly deps: GaugeSamplingDeps) {}

  async sampleHoursForOrg({
    organizationId,
    at,
  }: {
    organizationId: string;
    at: Date;
  }): Promise<void> {
    const sealed = currentSealedHour(at);
    const last = await this.deps.usageHourly.getLastSampledHour({
      organizationId,
    });

    // No history → start at the latest sealed hour, forward-only: a brand-new
    // billable org's past has no hourly contract to fill.
    let firstMs = last ? last.getTime() + MS_PER_HOUR : sealed.getTime();
    if (firstMs > sealed.getTime()) return; // already sampled

    // Drain oldest-first under the per-run cap; the next sweep continues.
    const lastMs = Math.min(
      sealed.getTime(),
      firstMs + (SAMPLE_CAP_HOURS_PER_RUN - 1) * MS_PER_HOUR,
    );

    // Steady-state fast path (ADR-039: the gauge row is O(1) for the CURRENT
    // hour): when exactly one new hour is due and no event is effective
    // after its boundary, the materialized gauge IS fold-to-H — no replay.
    if (firstMs === lastMs) {
      const pending = await this.deps.events.countEventsAfter({
        organizationId,
        after: new Date(firstMs),
      });
      if (pending === 0) {
        const row = await this.deps.gauge.findByOrganization({
          organizationId,
        });
        const gaugeBytes = row?.billableBytes ?? 0n;
        this.alarmIfDrifted({
          organizationId,
          sealedHour: new Date(firstMs),
          gaugeBytes,
        });
        await this.deps.usageHourly.recordHours({
          organizationId,
          rows: [
            {
              sealedHour: new Date(firstMs),
              megabytes: clampToMegabytes(gaugeBytes),
            },
          ],
        });
        return;
      }
    }

    const events = await this.deps.events.findAllByOrganization({
      organizationId,
      upTo: new Date(lastMs),
    });

    const rows: HourlySample[] = [];
    let gauge = 0n;
    let cursor = 0;
    let alarmed = false;

    for (let hourMs = firstMs; hourMs <= lastMs; hourMs += MS_PER_HOUR) {
      // Fold-to-H: apply every event effective at or before this hour.
      const next: typeof events = [];
      while (
        cursor < events.length &&
        events[cursor]!.occurredAt.getTime() <= hourMs
      ) {
        next.push(events[cursor]!);
        cursor += 1;
      }
      gauge = foldBoundaryEvents({ initialBytes: gauge, events: next });

      if (gauge < -NEGATIVE_DRIFT_TOLERANCE_BYTES && !alarmed) {
        alarmed = true;
        this.alarmIfDrifted({
          organizationId,
          sealedHour: new Date(hourMs),
          gaugeBytes: gauge,
        });
      }

      rows.push({
        sealedHour: new Date(hourMs),
        megabytes: clampToMegabytes(gauge),
      });
    }

    await this.deps.usageHourly.recordHours({ organizationId, rows });
  }

  private alarmIfDrifted({
    organizationId,
    sealedHour,
    gaugeBytes,
  }: {
    organizationId: string;
    sealedHour: Date;
    gaugeBytes: bigint;
  }): void {
    if (gaugeBytes >= -NEGATIVE_DRIFT_TOLERANCE_BYTES) return;
    logger.error(
      { organizationId, sealedHour, gaugeBytes },
      "ALARM: storage gauge folded below the negative-drift tolerance — " +
        "sampling clamps to zero; the gauge is NOT auto-corrected",
    );
    this.deps.onDriftAlarm({ organizationId, sealedHour, gaugeBytes });
  }
}

function clampToMegabytes(gaugeBytes: bigint): number {
  return gaugeBytes <= 0n
    ? 0
    : Number((gaugeBytes + BigInt(BYTES_PER_MIB) - 1n) / BigInt(BYTES_PER_MIB));
}
