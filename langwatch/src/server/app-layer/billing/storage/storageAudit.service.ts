import { createLogger } from "@langwatch/observability";
import type { BoundaryMeasurementService } from "./boundaryMeasurement.service";
import { foldBoundaryEvents } from "./gaugeFold";
import type { StorageAuditStateRepository } from "./repositories/storage-audit-state.repository";
import type { StorageBillableGaugeRepository } from "./repositories/storage-billable-gauge.repository";
import type { StorageBoundaryEventRepository } from "./repositories/storage-boundary-event.repository";
import { floorToDay, MS_PER_DAY } from "./sealedHour";
import type { StorageAuditTierService } from "./storageAuditTier.service";

const logger = createLogger("langwatch:billing:storageAudit");

/**
 * Full reference-audit coverage completes within this many days — the
 * natural rhythm for week-grained partitions. The per-day cap follows from
 * it (≈ partitions/7 per org per day). An INVARIANT, not a tunable
 * (ADR-039 perf F1): a bigger denominator is fine, a "check everything
 * daily" is the backlog scan reborn.
 */
export const REFERENCE_AUDIT_ROTATION_DAYS = 7;

/**
 * How far apart the re-measured truth and the recorded events may sit
 * before the reference audit alarms — ReplacingMergeTree merge noise makes
 * tiny signed drifts legitimate. Initial value; the rollout owns tuning it
 * (ADR-039 open question).
 *
 * Known limitation: the tolerance is per (project, partition) — diffuse
 * drift spread thinly across many partitions stays under it. The org-level
 * aggregate check below closes that with a wider bound.
 */
export const REFERENCE_AUDIT_TOLERANCE_BYTES = 100n * 1024n * 1024n; // 100 MiB

/**
 * Org-level bound on the SUM of per-partition drifts seen in one audit run
 * — catches diffuse drift that hides under the per-partition tolerance.
 */
export const REFERENCE_AUDIT_ORG_TOLERANCE_BYTES = 1024n * 1024n * 1024n; // 1 GiB

export interface StorageAuditDeps {
  events: StorageBoundaryEventRepository;
  gauge: StorageBillableGaugeRepository;
  auditState: StorageAuditStateRepository;
  measurement: Pick<BoundaryMeasurementService, "measureReferenceBytes">;
  tier: Pick<StorageAuditTierService, "computeTier">;
  /** Alarm sink (PostHog capture; on top of the persisted audit-state latch). */
  onAuditAlarm: (params: {
    organizationId: string;
    kind: "fold" | "reference";
    detail: Record<string, string>;
  }) => void;
}

/**
 * The two-layer daily audit (ADR-039 Decision 7). A delta-fold accumulates
 * error where a re-sum would self-correct it, so something must recount —
 * without recreating the backlog-scan the design eliminated:
 *
 * - FOLD AUDIT — Postgres only, zero ClickHouse: recompute the gauge from
 *   the immutable event log and compare to the materialized row. Catches
 *   fold/apply bugs next-day at zero CH cost.
 * - REFERENCE AUDIT — ClickHouse, capped: re-measure a rotating slice of
 *   the org's recorded partitions (full coverage every 7 days) and compare
 *   against the recorded live nets. Catches measurement-side drift (late
 *   arrivals, retroactive ALTERs, missed events).
 *
 * Discrepancies alarm and latch the org onto the permanent daily tier —
 * they are NEVER auto-corrected: the fix is the operator re-seed path.
 */
export class StorageAuditService {
  constructor(private readonly deps: StorageAuditDeps) {}

  /**
   * The sweep's daily entry point: consults the org's audit tier (alarmed
   * orgs and in-flight retention mutations pin daily — ADR-039 Decision 7)
   * and runs both audit layers when due. Weekly-tier orgs get their turn on
   * a stable weekly slot.
   */
  async runScheduledAudits({
    organizationId,
    at,
  }: {
    organizationId: string;
    at: Date;
  }): Promise<{ ran: boolean }> {
    const { tier } = await this.deps.tier.computeTier({ organizationId });
    if (tier === "weekly") {
      const dayIndex = Math.floor(floorToDay(at).getTime() / MS_PER_DAY);
      if ((dayIndex + hashSlot(organizationId)) % 7 !== 0) {
        return { ran: false };
      }
    }
    await this.runFoldAudit({ organizationId, at });
    await this.runReferenceAudit({ organizationId, at });
    return { ran: true };
  }

  /** PG-only: fold(event log) must equal the materialized gauge row. */
  async runFoldAudit({
    organizationId,
    at,
  }: {
    organizationId: string;
    at: Date;
  }): Promise<{ clean: boolean }> {
    // One transaction snapshot: independent reads can be torn by a
    // concurrent append (operator seed racing the sweep) into a phantom
    // alarm — and an alarm latches the org permanently.
    const { events, gaugeBytes } = await this.deps.events.snapshotFoldState({
      organizationId,
    });
    const folded = foldBoundaryEvents({ initialBytes: 0n, events });
    const stored = gaugeBytes;

    if (folded === stored) return { clean: true };

    logger.error(
      {
        organizationId,
        foldedBytes: folded.toString(),
        storedBytes: stored.toString(),
      },
      "ALARM: storage fold audit — gauge row disagrees with its own event log; " +
        "NOT auto-corrected (operator re-seed path owns recovery)",
    );
    await this.deps.auditState.recordAlarm({
      organizationId,
      kind: "fold",
      at,
    });
    this.deps.onAuditAlarm({
      organizationId,
      kind: "fold",
      detail: {
        foldedBytes: folded.toString(),
        storedBytes: stored.toString(),
      },
    });
    return { clean: false };
  }

  /**
   * ClickHouse, capped: today's rotation slice of the org's recorded
   * partitions is re-measured and compared to the recorded live nets.
   * Rotation is STATELESS — partition index modulo 7 selects by day — so
   * every partition is re-checked within 7 days with no cursor to corrupt.
   */
  async runReferenceAudit({
    organizationId,
    at,
  }: {
    organizationId: string;
    at: Date;
  }): Promise<{ clean: boolean; partitionsChecked: number }> {
    const groups = await this.deps.events.sumLiveNetGroups({ organizationId });

    // Recorded truth per (project, partition): the bytes the gauge carries,
    // plus each group's recorded exit instant — needed to skip partitions in
    // their seeded-tail window (see below).
    const byPartition = new Map<
      string,
      { recordedBytes: bigint; groups: typeof groups }
    >();
    for (const group of groups) {
      const key = `${group.projectId} ${group.partitionKey}`;
      const entry = byPartition.get(key) ?? { recordedBytes: 0n, groups: [] };
      entry.recordedBytes += group.netBytes;
      entry.groups.push(group);
      byPartition.set(key, entry);
    }

    const dayIndex = Math.floor(floorToDay(at).getTime() / MS_PER_DAY);
    let checked = 0;
    let clean = true;
    let aggregateDrift = 0n;

    for (const [
      key,
      { recordedBytes, groups: partitionGroups },
    ] of byPartition) {
      const [projectId, partitionKey] = key.split(" ") as [string, string];
      // Stateless rotation: this partition's turn comes when the day index
      // matches its slot; full coverage every REFERENCE_AUDIT_ROTATION_DAYS.
      const slot = hashSlot(key);
      if ((dayIndex + slot) % REFERENCE_AUDIT_ROTATION_DAYS !== 0) continue;

      // Seeded-tail skip: a seeded partition collapses its slices onto the
      // partition's last day, so its RECORDED entitlement runs up to 6 days
      // past the per-slice row truth the measurement uses. While `at` is
      // inside that window (row-truth exits begun, recorded exit not yet
      // due), recorded > measured is by construction, not drift.
      const partitionStartMs = Date.parse(`${partitionKey}T00:00:00.000Z`);
      const inSeededTail = partitionGroups.some((group) => {
        if (group.retentionDays === 0) return false;
        const recordedExitMs =
          group.sliceDate.getTime() + group.retentionDays * MS_PER_DAY;
        const rowTruthFirstExitMs =
          partitionStartMs + group.retentionDays * MS_PER_DAY;
        return (
          at.getTime() >= rowTruthFirstExitMs && at.getTime() < recordedExitMs
        );
      });
      if (inSeededTail) continue;

      checked += 1;
      const measured = await this.deps.measurement.measureReferenceBytes({
        projectId,
        partitionStart: new Date(partitionStartMs),
        at,
      });

      const drift =
        measured > recordedBytes
          ? measured - recordedBytes
          : recordedBytes - measured;
      aggregateDrift += drift;
      if (drift <= REFERENCE_AUDIT_TOLERANCE_BYTES) continue;

      clean = false;
      logger.error(
        {
          organizationId,
          projectId,
          partitionKey,
          recordedBytes: recordedBytes.toString(),
          measuredBytes: measured.toString(),
        },
        "ALARM: storage reference audit — recorded events disagree with " +
          "re-measured partition bytes; NOT auto-corrected",
      );
      await this.deps.auditState.recordAlarm({
        organizationId,
        kind: "reference",
        at,
      });
      this.deps.onAuditAlarm({
        organizationId,
        kind: "reference",
        detail: {
          projectId,
          partitionKey,
          recordedBytes: recordedBytes.toString(),
          measuredBytes: measured.toString(),
        },
      });
    }

    // Diffuse drift: many small per-partition drifts that individually stay
    // under tolerance must still alarm in aggregate.
    if (clean && aggregateDrift > REFERENCE_AUDIT_ORG_TOLERANCE_BYTES) {
      clean = false;
      logger.error(
        { organizationId, aggregateDriftBytes: aggregateDrift.toString() },
        "ALARM: storage reference audit — aggregate drift across partitions " +
          "exceeds the org tolerance; NOT auto-corrected",
      );
      await this.deps.auditState.recordAlarm({
        organizationId,
        kind: "reference",
        at,
      });
      this.deps.onAuditAlarm({
        organizationId,
        kind: "reference",
        detail: { aggregateDriftBytes: aggregateDrift.toString() },
      });
    }

    return { clean, partitionsChecked: checked };
  }
}

/** Stable small hash for rotation slotting. */
function hashSlot(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}
