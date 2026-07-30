const MAX_UINT64 = (1n << 64n) - 1n;

/**
 * The `ReplacingMergeTree` version for a billing ledger row. The engine keeps
 * the largest version, so inverting the acceptance millisecond elects the
 * EARLIEST accepted delivery of a key. Stamping the write instant instead would
 * make a replay the winner, moving a record's `AcceptedAt`/`AcceptedHour` into
 * the replay's billing hour.
 *
 * One derivation for both ledgers — `log_usage_estimates` and
 * `metric_usage_estimates` — because two copies is two things to keep in
 * agreement and the two rows are billed by the same rule.
 */
export function firstAcceptanceWins(acceptedAt: number): bigint {
  return MAX_UINT64 - BigInt(acceptedAt);
}
