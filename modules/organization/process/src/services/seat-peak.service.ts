import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EventingCommandSender } from "@langwatch/eventing";
import type { OrganizationSeatPeak } from "@langwatch/organization-contract";

import type {
  RecordSeatChangedCommandData,
  RecordSeatSnapshotCommandData,
} from "../eventing/seat-peak.events.ts";
import type { OrganizationSeatPeakRepository } from "../repositories/organization-seat-peak.repository.ts";
import type { OrganizationSeatRepository } from "../repositories/organization-seat.repository.ts";
import type { OrganizationRepository } from "../repositories/organization.repository.ts";
import { foldSeatPeak, type SeatPeakFact, seatPeakAsOf } from "../rules/seat-peak.rules.ts";

type Sender<Data> = Pick<EventingCommandSender<Data>, "send" | "sendBatch">;

export type SeatPeakSenders = Readonly<{
  recordSeatChanged: Sender<RecordSeatChangedCommandData>;
  recordSeatSnapshot: Sender<RecordSeatSnapshotCommandData>;
}>;

type SeatPeakDependencies = Readonly<{
  seats: Pick<OrganizationSeatRepository, "findSeatHolders">;
  peaks: Pick<OrganizationSeatPeakRepository, "getState" | "update">;
  organizations: Pick<OrganizationRepository, "listAllIds">;
  plans: Pick<EntitlementApi, "getActivePlan">;
}>;

/**
 * The monthly seat peak (ADR-002): opens an organization's count from a snapshot of every holder
 * as it stands, and answers the ops console's read. The senders arrive once the pipeline registers.
 */
export class SeatPeakService {
  static create(dependencies: SeatPeakDependencies): SeatPeakService {
    return new SeatPeakService(dependencies);
  }

  #senders: SeatPeakSenders | undefined;

  private constructor(private readonly dependencies: SeatPeakDependencies) {}

  connect(senders: SeatPeakSenders): void {
    this.#senders = senders;
  }

  /** The seat-change sender, for whoever commits a change through the outbox. */
  getChangeSender(): Sender<RecordSeatChangedCommandData> {
    const sender = this.#senders?.recordSeatChanged;
    if (!sender) throw new Error("organization_seat_peak is not registered in this process");
    return sender;
  }

  /**
   * Folds one fact into the stored count (ADR-002 §2), loading only the holder it moves and the
   * invitations due to expire by then; a snapshot loads no holder and writes every one.
   */
  async fold({
    organizationId,
    fact,
  }: {
    organizationId: string;
    fact: SeatPeakFact;
  }): Promise<void> {
    await this.dependencies.peaks.update(
      {
        organizationId,
        holders: fact.type === "seat_changed" ? [fact.data.holder] : [],
        dueBefore: fact.data.occurredAt,
      },
      (state) => foldSeatPeak({ state, fact }),
    );
  }

  /**
   * Records every holder's seat as it stands. Keyed by the organization and `occurredAt`, so a
   * redelivered opening records once; a second snapshot of an opened organization moves nothing.
   */
  async open({
    organizationId,
    occurredAt,
  }: {
    organizationId: string;
    occurredAt: number;
  }): Promise<void> {
    await this.#snapshotSender().send(await this.#snapshotOf({ organizationId, occurredAt }));
  }

  /**
   * Opens one page of organizations after the cursor; one whose count already opened is
   * skipped, so a re-run records nothing for it. A dry run reads and records nothing.
   */
  async openPage({
    afterOrganizationId,
    limit,
    dryRun,
    occurredAt,
  }: {
    afterOrganizationId: string | null;
    limit: number;
    dryRun: boolean;
    occurredAt: number;
  }): Promise<{ lastOrganizationId: string | null; organizations: number; opened: number }> {
    const page = await this.dependencies.organizations.listAllIds({
      ...(afterOrganizationId === null ? {} : { after: afterOrganizationId }),
      limit,
    });
    const unopened: string[] = [];
    for (const organizationId of page.ids) {
      const state = await this.dependencies.peaks.getState({
        organizationId,
        holders: [],
        dueBefore: 0,
      });
      if (state.openedAt === null) unopened.push(organizationId);
    }
    if (!dryRun && unopened.length > 0) {
      const snapshots: RecordSeatSnapshotCommandData[] = [];
      for (const organizationId of unopened) {
        snapshots.push(await this.#snapshotOf({ organizationId, occurredAt }));
      }
      await this.#snapshotSender().sendBatch(snapshots);
    }
    return {
      lastOrganizationId: page.ids.at(-1) ?? null,
      organizations: page.ids.length,
      opened: dryRun ? 0 : unopened.length,
    };
  }

  /** The counts, the plan's caps and every month's peaks; not counted before the opening. */
  async read({
    organizationId,
    now,
  }: {
    organizationId: string;
    now: number;
  }): Promise<OrganizationSeatPeak> {
    const [state, plan] = await Promise.all([
      this.dependencies.peaks.getState({ organizationId, holders: [], dueBefore: now }),
      this.dependencies.plans.getActivePlan({ organizationId }),
    ]);
    const caps = seatCapsOf({ fullSeats: plan.maxMembers, liteSeats: plan.maxMembersLite });
    if (state.openedAt === null) return { counted: false, caps };
    const asOf = seatPeakAsOf({ state, now });
    return {
      counted: true,
      countingSince: state.openedAt,
      seats: asOf.counts,
      caps,
      months: asOf.months
        .map(({ month, fullPeak, fullPeakAt, litePeak, litePeakAt }) => ({
          month,
          fullPeak,
          fullPeakAt,
          litePeak,
          litePeakAt,
        }))
        .reverse(),
      mismatches: state.mismatches,
    };
  }

  async #snapshotOf({
    organizationId,
    occurredAt,
  }: {
    organizationId: string;
    occurredAt: number;
  }): Promise<RecordSeatSnapshotCommandData> {
    const holders = await this.dependencies.seats.findSeatHolders(organizationId);
    return { tenantId: organizationId, organizationId, holders: [...holders], occurredAt };
  }

  #snapshotSender(): Sender<RecordSeatSnapshotCommandData> {
    const sender = this.#senders?.recordSeatSnapshot;
    if (!sender) throw new Error("organization_seat_peak is not registered in this process");
    return sender;
  }
}

/** An uncapped plan reports its cap as `Number.MAX_SAFE_INTEGER`, never a number to show. */
function seatCapsOf(caps: { fullSeats: number; liteSeats: number }): OrganizationSeatPeak["caps"] {
  const shown = (cap: number) => (cap >= Number.MAX_SAFE_INTEGER ? null : cap);
  return { fullSeats: shown(caps.fullSeats), liteSeats: shown(caps.liteSeats) };
}
