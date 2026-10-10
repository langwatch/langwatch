/**
 * The per-user fork: a closure the app composes, never a service this
 * package constructs (ADR-110). `true` means writes and reads switch
 * together, never half-migrated. Ships false for everyone today (ADR-101 §2).
 */
export type IdentityUserGate = (args: { userId: string }) => Promise<boolean>;
