/**
 * The per-user fork, as every collaborator takes it: a closure the app
 * composes, never a service this package constructs (named per ADR-110,
 * re-tenanted: true means this user's identifier history is proven, so
 * both writes and reads switch together — never half-migrated). Ships
 * false for everyone today (ADR-101 §2).
 */
export type IdentityUserGate = (args: { userId: string }) => Promise<boolean>;
