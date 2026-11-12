import type { EventingCommandSender } from "@langwatch/eventing";

import type {
  RecordSeatChangedCommandData,
  SeatChangeCause,
} from "../eventing/seat-peak.events.ts";
import type { OrganizationSeatPeakRepository } from "../repositories/organization-seat-peak.repository.ts";
import type { OrganizationSeatRepository } from "../repositories/organization-seat.repository.ts";
import { organizationSeatCorrections, seatKindOf } from "../rules/seat-change.rules.ts";
import { type SeatHolder, seatHolderId, type SeatKind } from "../rules/seat-holder.rules.ts";
import type { SeatPeakState } from "../rules/seat-peak.rules.ts";

type SeatChangeSender = Pick<EventingCommandSender<RecordSeatChangedCommandData>, "send">;

type SeatPeakCorrectionDependencies = Readonly<{
  seats: Pick<OrganizationSeatRepository, "findSeatHolders" | "findMemberSeat" | "findCountedHold">;
  peaks: Pick<OrganizationSeatPeakRepository, "getState">;
  /** The organizations a person holds an active membership in. */
  organizationIdsForMember: (input: { userId: string }) => Promise<string[]>;
  /** The app's seat-change sender; throws until organization_seat_peak registers. */
  changes: () => SeatChangeSender;
}>;

/** The peer fact a correction answers: its id keys the change, so a redelivery records once. */
type CorrectionSource = Readonly<{ eventId: string; occurredAt: number; cause: SeatChangeCause }>;

/**
 * Seats moved by writes organization does not make (ADR-002 §6): a directory create, a custom
 * role, an account deactivated, erased or offboarded. Each records the live seat as a change
 * dated at the source fact, which the fold's last-write-wins orders against the writers' own.
 */
export class SeatPeakCorrectionService {
  static create(dependencies: SeatPeakCorrectionDependencies): SeatPeakCorrectionService {
    return new SeatPeakCorrectionService(dependencies);
  }

  private constructor(private readonly dependencies: SeatPeakCorrectionDependencies) {}

  /**
   * Records one member's live seat, even when the fold already shows it: a change of theirs
   * dated before the source and still on its way is then outranked, not applied over it.
   */
  async correctMember({
    organizationId,
    userId,
    source,
  }: {
    organizationId: string;
    userId: string;
    source: CorrectionSource;
  }): Promise<void> {
    const state = await this.dependencies.peaks.getState({
      organizationId,
      holders: [
        { kind: "member", userId },
        { kind: "hold", userId, expiresAt: 0 },
      ],
      dueBefore: 0,
    });
    // Counting has not started: the opening snapshot reads every seat as it stands.
    if (state.openedAt === null) return;
    const live = seatKindOf(
      await this.dependencies.seats.findMemberSeat({ organizationId, userId }),
    );
    const changes = [
      {
        holder: { kind: "member", userId } as const,
        from: recordedSeat({ state, holder: { kind: "member", userId } }),
        to: live,
      },
      ...(await this.#holdCorrection({ organizationId, userId, state })),
    ];
    // A seat given back goes first, so a hold replacing a seat never raises the peak.
    for (const change of changes.toSorted(
      (a, b) => Number(a.to !== "none") - Number(b.to !== "none"),
    )) {
      await this.#record({ organizationId, ...change, source });
    }
  }

  /** A seat kept by a hold moves with its person: a departure outside organization's writes. */
  async #holdCorrection({
    organizationId,
    userId,
    state,
  }: {
    organizationId: string;
    userId: string;
    state: SeatPeakState;
  }): Promise<{ holder: SeatHolder; from: SeatKind; to: SeatKind }[]> {
    const [hold] = await this.dependencies.seats.findCountedHold({ organizationId, userId });
    const recorded = state.holds[userId];
    if (hold === undefined && recorded?.seat !== "full") return [];
    const expiresAt = hold?.heldUntil ?? recorded?.expiresAt ?? 0;
    return [
      {
        holder: { kind: "hold", userId, expiresAt },
        from: recorded?.seat ?? "none",
        to: hold ? "full" : "none",
      },
    ];
  }

  /**
   * Re-reads every holder after a change that names only a role or a grant, members and pending
   * invitations alike, and records each one found in a metered seat the fold has not recorded.
   */
  async correctOrganization({
    organizationId,
    source,
  }: {
    organizationId: string;
    source: CorrectionSource;
  }): Promise<void> {
    const state = await this.dependencies.peaks.getState({
      organizationId,
      holders: "seated",
      dueBefore: 0,
    });
    if (state.openedAt === null) return;
    const holders = await this.dependencies.seats.findSeatHolders(organizationId);
    const corrections = organizationSeatCorrections({
      readings: holders.map(({ holder, seat }) => ({
        holder,
        recorded: recordedSeat({ state, holder }),
        live: seat,
      })),
    });
    for (const { holder, recorded, live } of corrections) {
      await this.#record({ organizationId, holder, from: recorded, to: live, source });
    }
  }

  /** Gives back the seats of the fold's invitations that no longer hold one (an offboarding). */
  async correctInvitations({
    organizationId,
    source,
  }: {
    organizationId: string;
    source: CorrectionSource;
  }): Promise<void> {
    const state = await this.dependencies.peaks.getState({
      organizationId,
      holders: "seated",
      dueBefore: 0,
    });
    if (state.openedAt === null) return;
    const live = new Set<string>();
    for (const { holder } of await this.dependencies.seats.findSeatHolders(organizationId)) {
      if (holder.kind === "invitation") live.add(holder.inviteId);
    }
    for (const [inviteId, invitation] of Object.entries(state.invitations)) {
      if (live.has(inviteId) || invitation.seat === "none") continue;
      // An invitation past its expiry gave its seat back when it expired; the fold knows that.
      if (invitation.expiresAt !== null && invitation.expiresAt < source.occurredAt) continue;
      await this.#record({
        organizationId,
        holder: { kind: "invitation", inviteId, expiresAt: invitation.expiresAt },
        from: invitation.seat,
        to: "none",
        source,
      });
    }
  }

  /** Corrects one person in every organization they hold a membership in, or in those named. */
  async correctAccount({
    userId,
    organizationIds,
    source,
  }: {
    userId: string;
    organizationIds?: readonly string[];
    source: CorrectionSource;
  }): Promise<void> {
    const named = organizationIds ?? (await this.dependencies.organizationIdsForMember({ userId }));
    for (const organizationId of named) {
      await this.correctMember({ organizationId, userId, source });
    }
  }

  async #record({
    organizationId,
    holder,
    from,
    to,
    source,
  }: {
    organizationId: string;
    holder: SeatHolder;
    from: SeatKind;
    to: SeatKind;
    source: CorrectionSource;
  }): Promise<void> {
    const holderKey = `${holder.kind === "hold" ? "hold:" : ""}${seatHolderId(holder)}`;
    await this.dependencies.changes().send({
      tenantId: organizationId,
      organizationId,
      holder,
      from,
      to,
      cause: source.cause,
      actorUserId: null,
      occurredAt: source.occurredAt,
      changeId: `${source.cause}:${source.eventId}:${organizationId}:${holderKey}`,
    });
  }
}

function recordedSeat({ state, holder }: { state: SeatPeakState; holder: SeatHolder }): SeatKind {
  if (holder.kind === "member") return state.members[holder.userId]?.seat ?? "none";
  if (holder.kind === "hold") return state.holds[holder.userId]?.seat ?? "none";
  return state.invitations[holder.inviteId]?.seat ?? "none";
}
