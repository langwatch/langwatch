/**
 * How a run in progress is told to stop. A hint, never the record: what stops
 * a run is its `cancel_requested` event and the process manager's own state,
 * and this only keeps the next page from starting work it would throw away.
 * @see dev/docs/adr/153-instant-eval-run-is-a-judgment-job.md
 */

export interface InstantEvalCancellationChannel {
  /** Publishes the hint. Never throws: the event behind it is the record. */
  request(input: { runId: string }): Promise<void>;
  /**
   * Whether a stop was asked for. Answers false when it cannot be read, which
   * costs the run one more page rather than stopping a run nobody cancelled.
   */
  isRequested(input: { runId: string }): Promise<boolean>;
}
