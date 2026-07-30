/**
 * Local event-subscriber contract (ADR-098 decision 1): at-most-once, never
 * replayed, receives no projection state.
 *
 * `@langwatch/event-sourcing` does not yet export a subscriber contract or
 * router — the same gap noted in
 * `process-managers/processManager.types.ts` for the process-manager
 * runtime. This pipeline declares the shape it needs locally.
 *
 * The defining property is in the type, not just the docblock: `handle` has
 * no retry budget behind it in the eventual router. ADR-098: "the routing
 * path does not retry; nothing re-dispatches a subscriber's fan-out
 * afterwards, so a lost job is lost permanently." A subscriber may therefore
 * only ever carry work whose loss is acceptable — every subscriber in this
 * pipeline does nothing but submit a `recordMatch` command. That command's
 * committed event is the durable artefact; if the submission itself never
 * happens, the customer's trace simply produces no match, exactly as if the
 * match had never occurred. Nothing here EVER queues a notification send or
 * any other stake-bearing effect directly — that is what
 * `process-managers/` is for.
 */
export interface EnqueueOptions<SourceEvent> {
  /**
   * Total by construction. This doubles as the (future) router's enqueue
   * filter, which runs before any retry budget exists — a throw here loses
   * the source event's job permanently, so every implementation in this
   * pipeline is a `typeof` check, a length check, or a set lookup: no
   * decoding, no I/O, no fold read.
   */
  readonly filter: (event: SourceEvent) => boolean;
}

/** Collapses repeat deliveries that would otherwise re-run identical work —
 *  a burst of source events that all resolve to the same dedup id run this
 *  subscriber once for the window. `extend`/`replace` default to `true`;
 *  set both `false` for a non-extending, non-replacing window (the window
 *  closes on schedule regardless of continuing traffic, which is what stops
 *  a project under constant load from starving its own dedup window). */
export interface DeduplicationOptions<SourceEvent> {
  readonly makeId: (event: SourceEvent) => string;
  readonly ttlMs: number;
  readonly extend?: boolean;
  readonly replace?: boolean;
}

export interface SubscriberOptions<SourceEvent> {
  /** Holds the job for this long before `handle` runs, so a burst of source
   *  events lands before the subscriber reacts to the first of them. */
  readonly delay?: number;
  readonly deduplication?: DeduplicationOptions<SourceEvent>;
}

export interface AutomationSubscriber<SourceEvent> {
  readonly name: string;
  readonly eventTypes: readonly string[];
  readonly enqueue?: EnqueueOptions<SourceEvent>;
  readonly options?: SubscriberOptions<SourceEvent>;
  handle(event: SourceEvent, context: { tenantId: string }): Promise<void>;
}
