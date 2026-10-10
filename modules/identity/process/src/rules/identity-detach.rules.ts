import { type IdentityHeads, IdentityDetachStrandsUserError } from "@langwatch/identity-contract";

/**
 * Refuses removing an identifier that would strand the person. Pure and
 * exported so the detach guard and the Remove control share ONE answer,
 * never a screen's own drifting rule. Reads only what would be LEFT.
 */
export function assertDetachKeepsWayBack({
  heads,
  identifierId,
}: {
  heads: IdentityHeads;
  identifierId: string;
}): void {
  const remaining = Object.values(heads.identifiers).filter(
    (candidate) =>
      candidate.identifierId !== identifierId &&
      (candidate.state === "VERIFIED" || candidate.state === "PRIMARY"),
  );
  if (remaining.length === 0) {
    throw new IdentityDetachStrandsUserError(
      `detach_identifier: ${identifierId} is the last verified identifier for this user`,
    );
  }
  // A passkey is a way in and not a way back: it has no address, so a person
  // holding only passkeys has nowhere a recovery message could reach them.
  // The remedy the screen offers is a verified email.
  if (remaining.every((candidate) => candidate.provider === "passkey")) {
    throw new IdentityDetachStrandsUserError(
      `detach_identifier: removing ${identifierId} would leave this user with passkeys only and no recovery address`,
    );
  }
}
