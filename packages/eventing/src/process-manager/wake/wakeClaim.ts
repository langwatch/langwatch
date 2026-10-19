/**
 * How far a claim moves a due wake's nextWakeAt ahead, keeping it out of other workers' scans.
 * A commit replaces it and a failed handler releases it; only a crashed worker's claim runs to
 * the end, so its wakes fire about a minute late. Twelve 5s polls: a normal batch fits easily.
 */
export const WAKE_CLAIM_LEASE_MS = 60_000;
