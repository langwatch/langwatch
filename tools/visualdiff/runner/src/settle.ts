import type { SettleConfig } from "./protocol";

/**
 * Settling is event-driven, not a sleep. The tracker counts requests in
 * flight and reports quiet only once the count has sat at zero for the quiet
 * window — a fixed wait either photographs a half-rendered page or spends
 * minutes doing nothing across a hundred routes.
 */

/**
 * Requests that never finish, or that finish constantly, are not evidence a
 * page is still working: an event stream stays open for the life of the page,
 * and Vite's hot-update and dependency-optimizer traffic belongs to the dev
 * server rather than to the screen. Counting either one means never settling.
 */
const IGNORED_RESOURCE_TYPES = new Set(["eventsource", "websocket"]);

const VITE_PATTERN =
  /\/@vite\/|\/@react-refresh|\/node_modules\/\.vite\/|[?&]t=\d{10,}|hot-update|__vite_ping/;
const STREAM_PATTERN = /\/api\/[^?]*\/(stream|sse|events)\b|text\/event-stream/;

export const shouldIgnoreRequest = ({
  url,
  resourceType,
}: {
  url: string;
  resourceType: string;
}): boolean =>
  IGNORED_RESOURCE_TYPES.has(resourceType) || VITE_PATTERN.test(url) || STREAM_PATTERN.test(url);

export interface SettleDecision {
  quiet: boolean;
  expired: boolean;
}

/** InFlightTracker is the settle state machine, with no browser in it. */
export class InFlightTracker {
  private count = 0;
  private lastZeroAt: number;
  private readonly startedAt: number;

  constructor(
    private readonly settings: SettleConfig,
    now: number,
  ) {
    this.lastZeroAt = now;
    this.startedAt = now;
  }

  get inFlight(): number {
    return this.count;
  }

  started({ url, resourceType }: { url: string; resourceType: string }): void {
    if (shouldIgnoreRequest({ url, resourceType })) return;
    this.count += 1;
  }

  settled({ url, resourceType, now }: { url: string; resourceType: string; now: number }): void {
    if (shouldIgnoreRequest({ url, resourceType })) return;
    this.count = Math.max(0, this.count - 1);
    if (this.count === 0) this.lastZeroAt = now;
  }

  /**
   * decide reports quiet and expired. A caller stops on either: giving up at
   * the deadline keeps one polling screen from hanging a run of two hundred.
   */
  decide(now: number): SettleDecision {
    return {
      quiet: this.count === 0 && now - this.lastZeroAt >= this.settings.quietMillis,
      expired: now - this.startedAt >= this.settings.deadlineMillis,
    };
  }

  /** restart begins a new settle window without discarding the count. */
  restart(now: number): InFlightTracker {
    const next = new InFlightTracker(this.settings, now);
    next.count = this.count;
    next.lastZeroAt = this.count === 0 ? now : this.lastZeroAt;
    return next;
  }
}
