import type { PlatformFrame } from "./protocol";

/**
 * The calls one connection has already been handed.
 *
 * A connection learns about calls two ways: the subscription that carries
 * every call written from now on, and the scan of pending calls that runs
 * once it is registered. A call written between the two reaches both, and a
 * command handed over twice runs twice on the developer's machine. So each
 * connection keeps the ids it sent and hands a call over once. An id is
 * dropped when the call's result arrives, so the set stays as small as the
 * calls in flight.
 */
export class DeliveredCalls {
  private readonly ids = new Set<string>();

  /** True when the frame should go out: a call already handed over does not. */
  admit(frame: PlatformFrame): boolean {
    if (frame.type !== "call") return true;
    if (this.ids.has(frame.call.callId)) return false;
    this.ids.add(frame.call.callId);
    return true;
  }

  settle(callId: string): void {
    this.ids.delete(callId);
  }
}
