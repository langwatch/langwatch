/**
 * The per-user fork, as every collaborator takes it: a closure the app
 * composes, never a service this package constructs. Named for the same
 * reason `AuthzEpochBumper` is named in authz — a bare inline function type
 * repeated at five call sites says nothing about what it decides.
 *
 * True means this user's identifier history is in the log and proven, so
 * identity answers for them. ADR-110's rule, re-tenanted: finishing the
 * migration IS the switch, and it is ONE switch — the same `finalized`
 * status forks the writes (a ceremony emits events) and the reads (the
 * projection answers for `User.email`). A user is never half-migrated with
 * reads on one side and writes on the other.
 *
 * It ships false for everyone (ADR-101 §2).
 */
export type IdentityUserGate = (args: { userId: string }) => Promise<boolean>;
