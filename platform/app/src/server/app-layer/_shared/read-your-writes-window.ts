/**
 * How long a caller waits to read its own write, and how often it looks.
 *
 * ── Why this file exists ────────────────────────────────────────────────
 *
 * There were five copies of this pair and they did not agree. Identity said
 * 2,000ms with a 25ms poll, written out four times — once each in `ledger.ts`,
 * `mfa-ledger.ts`, `join-request-ledger.ts` and `sso-connection-ledger.ts`.
 * Authz said 8,000ms with a 150ms poll. Same mechanism, same comparison
 * against the same kind of projection cursor, four times the window and six
 * times the poll interval apart.
 *
 * Neither number came from a latency distribution. Both ledgers are unshipped
 * — neither file exists on `main` — so there was no production fold to measure
 * when either was written, and the spread is what that looks like: had either
 * been derived, they would have landed near each other.
 *
 * ── Why there are two of them, and not one ──────────────────────────────
 *
 * Collapsing five constants to one is the easy half. The harder half is that
 * one number cannot be right, because the waits are not answering the same
 * question:
 *
 *   A person submitted a form and the response is being held open.
 *     Every millisecond here is a millisecond somebody spends looking at a
 *     button they already pressed. The window is short because the honest
 *     fallback — tell them it is still going — beats holding the socket.
 *
 *   A worker is deciding what to do next and nobody is watching.
 *     The only cost of waiting is the job slot. Being *right* is worth far
 *     more than being quick, because the alternative is acting on a fact the
 *     log may not hold — which is exactly the class of defect ADR-135 exists
 *     to remove.
 *
 * So the two old numbers were not one argument with a wrong answer. They were
 * two questions that were never distinguished, each answered plausibly, and
 * then each applied to both cases by whichever file was copied next. Naming
 * the cases is the fix; picking a winner between 2,000 and 8,000 would only
 * have moved the error.
 *
 * ── Where the numbers come from, and what replaces them ─────────────────
 *
 * They are still estimates, and this comment is the place that says so rather
 * than four files that imply otherwise. `identity_commit_duration_seconds`
 * (`identity/metrics.ts`) already times exactly what these bound — the append,
 * the staging and this wait — with buckets to five seconds, and
 * `identity_projection_convergence_timeouts_total` counts the waits that gave
 * up. The first production week of that histogram is what should set these:
 * take the p99 of the fold and sit above it, so that timing out stays rare
 * enough to be worth handling well.
 *
 * Until then: the interactive window is the ceiling of what a submitted form
 * can hold without the page reading as broken, and the background window is
 * generous because nothing is lost by spending it.
 *
 * @see dev/docs/adr/135-a-write-states-its-facts-once.md — under which the
 *      sign-up door does NOT wait on either of these. The session is issued
 *      from the write that landed; only surfaces that read projections carry a
 *      pending state. These windows are for callers that genuinely cannot
 *      continue without reading what they wrote.
 */
export interface ReadYourWritesWindow {
  /** Give up after this long and say so. The facts stay durable either way. */
  timeoutMs: number;
  /** How long to sleep between reads of the projection cursor. */
  pollMs: number;
}

/**
 * A person is waiting on this HTTP request.
 *
 * Two seconds, because past that a held response stops reading as slow and
 * starts reading as broken, and the poll is 50ms rather than identity's old
 * 25ms: at 25ms a two-second wait is eighty reads of the same projection row,
 * and the fold either lands in the first few or is not landing on this
 * timescale at all. Halving the read volume costs a person nothing they can
 * perceive.
 */
export const INTERACTIVE_READ_YOUR_WRITES: ReadYourWritesWindow = {
  timeoutMs: 2_000,
  pollMs: 50,
};

/**
 * A worker is waiting, and nobody is watching it.
 *
 * Eight seconds, because a background caller that acts on an unconverged read
 * is the defect this whole wait exists to prevent, and the only thing spent by
 * waiting longer is a job slot. The poll is correspondingly lazy — over a
 * window this long, 250ms costs at most thirty-two reads and no accuracy.
 */
export const BACKGROUND_READ_YOUR_WRITES: ReadYourWritesWindow = {
  timeoutMs: 8_000,
  pollMs: 250,
};
