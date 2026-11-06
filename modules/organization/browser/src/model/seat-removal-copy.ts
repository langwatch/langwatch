/**
 * The words the remove dialog and the Users list use for a seat that frees now or later
 * (specs/licensing/seat-rotation.feature). Never suggests removing someone to free a seat.
 */
import { Temporal } from "@langwatch/time";

/** "3 Dec": the day a held seat frees, in the reader's own calendar. */
export function seatFreesOnLabel(isoInstant: string): string {
  return Temporal.Instant.from(isoInstant)
    .toZonedDateTimeISO(Temporal.Now.timeZoneId())
    .toLocaleString("en-GB", { day: "numeric", month: "short" });
}

/** The person's name as a sentence reads it. */
export function personName({ name, email }: { name: string | null; email: string | null }) {
  return name || email || "this person";
}

export type SeatRemovalCopy = {
  body: string;
  /** Who the freed seat can go to, when it frees at once and somebody waits. */
  offer: { userId: string; name: string } | null;
};

/**
 * What the dialog says about the seat; `null` preview means it has not loaded or failed. A person
 * without a full seat (a Lite Member or Developer) frees none, so nothing is offered.
 */
export function seatRemovalCopy(
  preview: {
    holdsFullSeat: boolean;
    seatFreesAt: string | null;
    waiting: { userId: string; name: string | null; email: string | null } | null;
  } | null,
): SeatRemovalCopy {
  if (!preview?.holdsFullSeat) {
    return { body: "They lose access to everything in it.", offer: null };
  }
  if (preview.seatFreesAt) {
    return {
      body: `They lose access now. Their seat stays taken until ${seatFreesOnLabel(
        preview.seatFreesAt,
      )}, 30 days after they joined.`,
      offer: null,
    };
  }
  return {
    body: "Their seat frees up right away.",
    offer: preview.waiting
      ? { userId: preview.waiting.userId, name: personName(preview.waiting) }
      : null,
  };
}

/** The confirm button: it names the person the seat goes to when the box is ticked. */
export function removeButtonLabel({
  offer,
  giveSeat,
}: {
  offer: SeatRemovalCopy["offer"];
  giveSeat: boolean;
}): string {
  return offer && giveSeat ? `Remove and give the seat to ${offer.name}` : "Remove";
}

/** A held seat's chip: Deactivated once removed; the full seat when disabled or demoted. */
export function heldSeatChipLabel({
  seatFreesAt,
  reason,
}: {
  seatFreesAt: string;
  reason: "REMOVED" | "DISABLED" | "DEMOTED";
}): string {
  const day = seatFreesOnLabel(seatFreesAt);
  return reason === "REMOVED" ? `Deactivated, seat frees ${day}` : `Full seat frees ${day}`;
}
