import type { EventingCommandSender } from "@langwatch/eventing";

import type {
  RecordSeatChangedCommandData,
  SeatChangeCause,
} from "../eventing/seat-peak.events.ts";
import type { OrganizationSeatPeakRepository } from "../repositories/organization-seat-peak.repository.ts";
import type { OrganizationSeatRepository } from "../repositories/organization-seat.repository.ts";
import { memberSeatCorrections, movesASeat } from "../rules/seat-change.rules.ts";
import type { SeatHolder, SeatKind } from "../rules/seat-holder.rules.ts";

type SeatChangeSender = Pick<EventingCommandSender<RecordSeatChangedCommandData>, "send">;

type SeatPeakCorrectionDependencies = Readonly<{
  seats: Pick<OrganizationSeatRepository, "findSeatHolders">;
  peaks: Pick<OrganizationSeatPeakRepository, "findState">;
  /** The organizations a person holds an active membership in. */
  organizationIdsForMember: (input: { userId: string }) => Promise<string[]>;
  /** The app's seat-change sender; throws until organization_seat_peak registers. */
  changes: () => SeatChangeSender;
}>;

/** The peer fact a correction answers: its id keys the change, so a redelivery records once. */
type CorrectionSource = Readonly<{ eventId: string; occurredAt: number; cause: SeatChangeCause }>;

/**
 * Seats moved by writes organization does not make (ADR-002 §6): a directory create, a custom
 * role binding, a whole account deactivated, erased or offboarded. Each compares the seat a holder
 * holds now with the seat the fold last recorded and records the difference as a seat change.
 */
export class SeatPeakCorrectionService {
  static create(dependencies: SeatPeakCorrectionDependencies): SeatPeakCorrectionService {
    return new SeatPeakCorrectionService(dependencies);
  }

  private constructor(private readonly dependencies: SeatPeakCorrectionDependencies) {}

  /**
   * Corrects every member of one organization, or only `userIds`. With `acrossViewOnlyLineOnly`
   * only a Lite Member and full seat swap is recorded, which is all a custom role can move.
   */
  async correctMembers({
    organizationId,
    userIds,
    acrossViewOnlyLineOnly = false,
    source,
  }: {
    organizationId: string;
    userIds?: readonly string[];
    acrossViewOnlyLineOnly?: boolean;
    source: CorrectionSource;
  }): Promise<void> {
    const state = await this.dependencies.peaks.findState(organizationId);
    // Counting has not started: the opening snapshot reads every seat as it stands.
    if (state?.openedAt == null) return;
    const live = new Map<string, SeatKind>();
    for (const { holder, seat } of await this.dependencies.seats.findSeatHolders(organizationId)) {
      if (holder.kind === "member") live.set(holder.userId, seat);
    }
    const concerned = userIds ?? [...new Set([...Object.keys(state.members), ...live.keys()])];
    const corrections = memberSeatCorrections({
      readings: concerned.map((userId) => ({
        userId,
        recorded: state.members[userId]?.seat ?? "none",
        live: live.get(userId) ?? "none",
      })),
      acrossViewOnlyLineOnly,
    });
    for (const { userId, from, to } of corrections) {
      await this.#record({
        organizationId,
        holder: { kind: "member", userId },
        from,
        to,
        source,
      });
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
    const state = await this.dependencies.peaks.findState(organizationId);
    if (state?.openedAt == null) return;
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

  /**
   * Counts the seat a directory create gave, as SCIM's fact names it: the members table is not
   * read again. The create's id keys the change, so a redelivered fact records once.
   */
  async countDirectoryCreate({
    organizationId,
    userId,
    seat,
    source,
  }: {
    organizationId: string;
    userId: string;
    seat: SeatKind;
    source: CorrectionSource;
  }): Promise<void> {
    const state = await this.dependencies.peaks.findState(organizationId);
    if (state?.openedAt == null) return;
    await this.#record({
      organizationId,
      holder: { kind: "member", userId },
      from: "none",
      to: seat,
      source,
    });
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
      await this.correctMembers({ organizationId, userIds: [userId], source });
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
    if (!movesASeat({ from, to })) return;
    const holderKey = holder.kind === "member" ? holder.userId : holder.inviteId;
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
