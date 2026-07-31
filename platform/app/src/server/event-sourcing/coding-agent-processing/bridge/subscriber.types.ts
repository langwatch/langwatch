/**
 * Local event-subscriber contract (ADR-098 decision 1): at-most-once, never
 * replayed, no projection state, no retry budget. A subscriber may therefore
 * only carry work whose loss is acceptable.
 */
export interface EnqueueOptions<SourceEvent> {
  /**
   * Total by construction — this doubles as the router's enqueue filter,
   * which runs before any retry budget exists. A throw here loses the
   * source event's job permanently, so every implementation in this
   * pipeline is a `typeof`/length/set check: no decoding, no I/O, no fold
   * read.
   */
  readonly filter: (event: SourceEvent) => boolean;
}

export interface DeduplicationOptions<SourceEvent> {
  readonly makeId: (event: SourceEvent) => string;
  readonly ttlMs: number;
}

export interface SubscriberOptions<SourceEvent> {
  readonly deduplication?: DeduplicationOptions<SourceEvent>;
}

export interface CodingAgentBridgeSubscriber<SourceEvent> {
  readonly name: string;
  readonly eventTypes: readonly string[];
  readonly enqueue?: EnqueueOptions<SourceEvent>;
  readonly options?: SubscriberOptions<SourceEvent>;
  handle(event: SourceEvent): Promise<void>;
}
