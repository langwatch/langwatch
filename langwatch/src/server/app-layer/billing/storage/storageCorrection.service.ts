import type { RetentionCategory } from "~/server/data-retention/retentionPolicy.schema";
import { BILLABLE_AFTER_DAYS } from "./boundaryCalendar";
import type {
  AppendBoundaryEventInput,
  StorageBoundaryEventRepository,
} from "./repositories/storage-boundary-event.repository";
import { MS_PER_DAY } from "./sealedHour";

export type EmittedCorrection = AppendBoundaryEventInput;

/**
 * The correction edges (ADR-039 Decision 3). Both work purely from the
 * recorded event log — the events ARE what the gauge counted, so negating
 * them is exact by construction: unseeded or never-measured data was never
 * billed and needs no correction, and a group already exited/deleted nets to
 * zero and self-skips.
 */
export class StorageCorrectionService {
  constructor(
    private readonly deps: { events: StorageBoundaryEventRepository },
  ) {}

  /**
   * Erasure / project deletion: negate every live group of the project,
   * keyed by the deletion's cause id, BEFORE the data is deleted — the
   * invoice drops the same hour, on the customer's action, not on
   * ClickHouse's deletion schedule. Callers (the erasure runbook, any future
   * hard-delete path) MUST call this first.
   */
  async emitDataDeletion({
    organizationId,
    projectId,
    causeId,
    at,
  }: {
    organizationId: string;
    projectId: string;
    /** Erasure-request / deletion id — corrections without a cause collapse on replay. */
    causeId: string;
    at: Date;
  }): Promise<void> {
    const groups = await this.deps.events.sumLiveNetGroups({
      organizationId,
      projectId,
    });

    for (const group of groups) {
      await this.deps.events.append({
        organizationId,
        projectId: group.projectId,
        category: group.category as RetentionCategory,
        partitionKey: group.partitionKey,
        sliceDate: group.sliceDate,
        retentionDays: group.retentionDays,
        edge: "DELETION",
        deltaBytes: -group.netBytes,
        occurredAt: at,
        causeId,
      });
    }
  }

  /**
   * Retention change with apply-to-existing (reverse-then-emit): for every
   * live group under a different retention, emit the exact negation keyed by
   * the change id, then re-book the bytes under the new retention — so
   * future exits follow the new entitlement and the gauge value itself is
   * unchanged. Re-booking is skipped when the new retention makes the bytes
   * non-billable (≤ 35d) or already past entitlement (lowering retention
   * onto old data = they leave the bill now, deletion-like).
   *
   * Runs BEFORE the `ALTER UPDATE _retention_days` mutation: entry
   * measurement groups by the row-level `_retention_days`, so the recorded
   * groups must be re-booked in the same motion that relabels the rows. A
   * wedged mutation leaves measurement and records split across groups —
   * the audit tier owns flagging that (phase 3).
   *
   * A change that does NOT apply to existing rows needs no correction at
   * all: old rows keep their old `_retention_days` and every recorded group
   * remains true.
   */
  async emitRetentionChange({
    organizationId,
    projectId,
    category,
    newRetentionDays,
    causeId,
    at,
  }: {
    organizationId: string;
    projectId: string;
    category: RetentionCategory;
    newRetentionDays: number;
    /** Retention-change id — 63→91→63 must keep both changes' events distinct. */
    causeId: string;
    at: Date;
  }): Promise<{ emitted: EmittedCorrection[] }> {
    const emitted: EmittedCorrection[] = [];
    const groups = await this.deps.events.sumLiveNetGroups({
      organizationId,
      projectId,
    });

    for (const group of groups) {
      if (group.category !== category) continue;
      if (group.retentionDays === newRetentionDays) continue;

      const reversal = {
        organizationId,
        projectId: group.projectId,
        category,
        partitionKey: group.partitionKey,
        sliceDate: group.sliceDate,
        retentionDays: group.retentionDays,
        edge: "REVERSAL",
        deltaBytes: -group.netBytes,
        occurredAt: at,
        causeId,
      } as const;
      await this.deps.events.append(reversal);
      emitted.push(reversal);

      const billableUnderNew =
        newRetentionDays === 0 || newRetentionDays > BILLABLE_AFTER_DAYS;
      const stillEntitled =
        newRetentionDays === 0 ||
        group.sliceDate.getTime() + newRetentionDays * MS_PER_DAY >
          at.getTime();
      if (!billableUnderNew || !stillEntitled) continue;

      const rebook = {
        organizationId,
        projectId: group.projectId,
        category,
        partitionKey: group.partitionKey,
        sliceDate: group.sliceDate,
        retentionDays: newRetentionDays,
        edge: "ENTRY",
        deltaBytes: group.netBytes,
        occurredAt: at,
        causeId,
      } as const;
      await this.deps.events.append(rebook);
      emitted.push(rebook);
    }

    return { emitted };
  }

  /**
   * Undo a reverse-then-emit whose row-relabeling mutation was NEVER
   * submitted (triggerUpdate threw): append the exact inverse of every
   * emitted correction, keyed by a rollback cause, so the gauge returns to
   * matching the untouched rows. This is for the never-applied case only —
   * a mutation that wedges partway is the audit tier's job, not a rollback.
   */
  async rollbackRetentionChange({
    emitted,
    causeId,
    at,
  }: {
    emitted: EmittedCorrection[];
    causeId: string;
    at: Date;
  }): Promise<void> {
    for (const event of emitted) {
      await this.deps.events.append({
        ...event,
        edge: "REVERSAL",
        deltaBytes: -event.deltaBytes,
        occurredAt: at,
        causeId: `${causeId}_rollback`,
      });
    }
  }
}
