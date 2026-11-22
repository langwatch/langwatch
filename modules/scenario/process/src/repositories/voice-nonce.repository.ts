/** What taking a nonce found: the registration it was stored for, answered at most once. */
export type TakenVoiceNonce = { taken: true; registration: string } | { taken: false };

/**
 * Every worker's live Twilio media nonces: single-use and time-boxed, so a replayed or
 * late dial-back finds nothing (dev/docs/ARCHITECTURE.md §8, Alex 2026-09-28).
 */
export interface VoiceNonceRepository {
  /** Stores `nonce` for `registration` for `ttlSeconds`; storing it again re-arms the clock. */
  store(input: { nonce: string; registration: string; ttlSeconds: number }): Promise<void>;
  /** Removes `nonce` and answers what it was stored for, as one step, so one taker wins. */
  take(nonce: string): Promise<TakenVoiceNonce>;
  /** Drops `nonce` without taking it. */
  discard(nonce: string): Promise<void>;
}
