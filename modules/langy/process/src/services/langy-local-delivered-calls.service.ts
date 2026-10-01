import type { PlatformFrame } from "@langwatch/langy-contract";

/**
 * The calls one connection has already been handed. A connection learns about
 * calls via both a subscription and a pending-calls scan, which can overlap,
 * so each connection dedupes by id and drops it once the result arrives.
 */
export class DeliveredCallsService {
  private readonly ids = new Set<string>();

  static create(): DeliveredCallsService {
    return new DeliveredCallsService();
  }

  private constructor() {}

  /**
   * Claim an id without sending anything: the command line said it is already
   * running this call, so the connection must not hand it over again.
   */
  reserve(callId: string): void {
    this.ids.add(callId);
  }

  /** True when the frame should go out: a call already handed over does not. */
  admit(frame: PlatformFrame): boolean {
    if (frame.type !== "call") {
      return true;
    }

    if (this.ids.has(frame.call.callId)) {
      return false;
    }

    this.ids.add(frame.call.callId);

    return true;
  }

  settle(callId: string): void {
    this.ids.delete(callId);
  }
}
