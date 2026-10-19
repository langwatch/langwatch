/**
 * How far a claim moves a due wake's nextWakeAt ahead, keeping it out of other workers' scans.
 * A commit replaces it and a failed handler releases it; only a crashed worker's claim runs to
 * the end, so its wakes fire about a minute late. Twelve 5s polls: a normal batch fits easily.
 */
export const WAKE_CLAIM_LEASE_MS = 60_000;

/** A wake starts only while this much of the claim remains, so its handling ends inside it. */
export const WAKE_CLAIM_SAFETY_MARGIN_MS = WAKE_CLAIM_LEASE_MS * 0.2;
