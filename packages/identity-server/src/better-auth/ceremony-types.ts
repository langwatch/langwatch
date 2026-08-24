/**
 * The per-user write gate as the ceremonies take it: a closure the app
 * composes, never a service this package constructs. Named for the same
 * reason `AuthzEpochBumper` is named in authz — a bare inline function type
 * repeated at four call sites says nothing about what it decides.
 *
 * True means this user's identifier history is already in the log, so a
 * domain-significant write runs its ceremony. It ships false for everyone
 * (ADR-101 §2).
 */
export type IdentityWriteGate = (args: {
  userId: string;
}) => Promise<boolean>;

/** The effect seams the ceremonies share, composed once in the app. */
export interface IdentityCeremonyClock {
  now: () => number;
  newCommandId: () => string;
}
