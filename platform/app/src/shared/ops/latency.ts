/**
 * How many completed jobs each queue keeps in its rolling latency sample
 * (`<queue>:gq:stats:latencies-ms`, written by GroupQueue on every completion
 * and trimmed to this length).
 *
 * The dashboard's P50/P99 tiles are computed over this sample, so their basis
 * is a sample SIZE, not a time window: at hundreds of jobs a second the sample
 * spans under a second of wall clock, at one job a minute it spans hours.
 * Shared between the queue (which trims to it) and the tiles (which say so),
 * so the copy can never drift from what the queue actually keeps.
 */
export const LATENCY_SAMPLE_SIZE = 200;
