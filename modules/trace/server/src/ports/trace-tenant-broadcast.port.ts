/**
 * The realtime fan-out the trace ingestion path tells a tenant's tabs through.
 *
 * Two subscribers reach it — the trace summary fold advancing and spans landing
 * in storage — and both want one thing: put this already-serialised payload in
 * front of every browser watching this tenant. Neither subscribes, neither
 * emits locally, and neither knows whether the process it is running in is
 * serving a tab at all.
 *
 * ## The wire format is the contract, not this class
 *
 * The subscriber on the far side lives in the application
 * (`platform/app/src/server/app-layer/broadcast/broadcast.service.ts`) and type-
 * checks against nothing here. It matches its Redis channel by exact string and
 * destructures `{ tenantId, event }` out of the parsed body. Drift is silent in
 * both directions: an unknown channel is accepted by Redis and delivered to
 * nobody, and a body missing a key it reads is dropped inside its own
 * `JSON.parse` handler. In both cases the durable write succeeded, the job
 * reported success, and the customer's screen simply stopped moving. So the
 * channel and the body are pinned by literal in the composition test that
 * drives this port, not derived from a constant only one side compiles.
 *
 * ## Why the arguments are positional
 *
 * They are the application's own `broadcastToTenant` signature, argument for
 * argument. The application satisfies this port structurally with the
 * broadcaster it already has, which is what lets Trace name a port here without
 * a single edit on that side. Named parameters would be the house style and
 * would also fork the two halves.
 *
 * `eventType` is narrowed to the one member Trace publishes. The full member
 * list is the application's `BroadcastEventType`; a background process
 * composing this receives an implementation that can reach the others, and
 * Trace deliberately cannot.
 */
export abstract class TraceTenantBroadcastPort {
  /**
   * The one channel the trace path publishes on, as the far side spells it.
   *
   * A literal rather than an import: the constant that would be shared is in
   * the application, and a package may not read it.
   */
  static readonly EVENT_TYPE = "trace_updated" as const;

  abstract broadcastToTenant(
    tenantId: string,
    /** The already-serialised payload the browser receives verbatim. */
    event: string,
    eventType: "trace_updated",
  ): Promise<void>;
}
