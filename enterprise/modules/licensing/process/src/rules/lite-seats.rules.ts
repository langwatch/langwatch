import { UNLIMITED } from "@langwatch/plans";

/** Lite seats as a registry or activation-code row stores them (WEB-19102). */
export type StoredLiteSeats = { maxMembersLite: number | null; liteSeatsUnlimited: boolean };

/** A signed license's lite seats as a row stores them: unlimited is a flag, never a number. */
export function storedLiteSeats({ signed }: { signed: number | undefined }): StoredLiteSeats {
  if (signed === UNLIMITED) return { maxMembersLite: null, liteSeatsUnlimited: true };
  return { maxMembersLite: signed ?? null, liteSeatsUnlimited: false };
}

/** A stored row's lite seats as a license signs them, the inverse of `storedLiteSeats`. */
export function signedLiteSeats(row: StoredLiteSeats): { membersLite: number | undefined } {
  if (row.liteSeatsUnlimited) return { membersLite: UNLIMITED };
  return { membersLite: row.maxMembersLite ?? undefined };
}
