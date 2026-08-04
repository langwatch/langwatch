/**
 * The intentional retry signal for a Langy worker dispatch.
 *
 * Initial dispatch runs through the process outbox; heartbeat recovery runs as
 * an event subscriber. Throwing leaves retry ownership with the active durable
 * delivery mechanism instead of emitting a second domain event. Dispatch is
 * idempotent on turnId (Go `ClaimTurn`), so a retry that races a now-live worker
 * is a benign no-op.
 */
export class LangyTurnDispatchRetry extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LangyTurnDispatchRetry";
  }
}
