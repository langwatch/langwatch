import type { RetentionCategory } from "~/server/data-retention/retentionPolicy.schema";
import type { StorageBoundaryEventRepository } from "./repositories/storage-boundary-event.repository";
import { MS_PER_DAY } from "./sealedHour";

/**
 * The exit edge (ADR-039 Decision 3): when a slice-group's retention
 * entitlement ends, its exit is the exact mirror of what was recorded for it
 * — the group's live net, negated. NO ClickHouse query, ever (this module
 * must never import a ClickHouse client): physical TTL timing cannot corrupt
 * the gauge because the bill follows the recorded entitlement.
 *
 * A group that was already exited, fully deleted, or fully re-booked by a
 * retention change nets to zero and is skipped — the live-net model makes
 * every downstream edge (exit, deletion, re-book) compose without special
 * cases. Indefinite retention (0) never exits.
 */
export class BoundaryExitService {
  constructor(
    private readonly deps: { events: StorageBoundaryEventRepository },
  ) {}

  async emitExitsDue({
    organizationId,
    at,
  }: {
    organizationId: string;
    at: Date;
  }): Promise<void> {
    const groups = await this.deps.events.sumLiveNetGroups({ organizationId });

    for (const group of groups) {
      if (group.retentionDays === 0) continue; // keep forever — never exits

      const exitAt = new Date(
        group.sliceDate.getTime() + group.retentionDays * MS_PER_DAY,
      );
      if (exitAt.getTime() > at.getTime()) continue; // not due yet

      await this.deps.events.append({
        organizationId,
        projectId: group.projectId,
        category: group.category as RetentionCategory,
        partitionKey: group.partitionKey,
        sliceDate: group.sliceDate,
        retentionDays: group.retentionDays,
        edge: "EXIT",
        deltaBytes: -group.netBytes,
        occurredAt: exitAt,
      });
    }
  }
}
