import type { SettleConfig } from "./protocol";

/**
 * Event-driven settling avoids half-rendered captures without adding a fixed delay to
 * every route.
 */

/** Ignore lifetime streams and Vite traffic or the page never settles. */
const IGNORED_RESOURCE_TYPES = new Set(["eventsource", "websocket"]);

const VITE_PATTERN =
  /\/@vite\/|\/@react-refresh|\/node_modules\/\.vite\/|[?&]t=\d{10,}|hot-update|__vite_ping/;
const STREAM_PATTERN = /\/api\/[^?]*\/(stream|sse|events)\b|text\/event-stream/;
/** Browser telemetry is fire-and-forget: its POSTs are aborted by every navigation. */
const TELEMETRY_PATTERN = /\/api\/rum\/v1\/traces\b/;

/** LONG_LIVED_MILLIS is the age past which a request is a poll, not part of the screen's load. */
export const LONG_LIVED_MILLIS = 8000;

export const shouldIgnoreRequest = ({
  url,
  resourceType,
}: {
  url: string;
  resourceType: string;
}): boolean =>
  IGNORED_RESOURCE_TYPES.has(resourceType) ||
  VITE_PATTERN.test(url) ||
  STREAM_PATTERN.test(url) ||
  TELEMETRY_PATTERN.test(url);

export interface SettleDecision {
  quiet: boolean;
  expired: boolean;
}

interface Pending {
  url: string;
  startedAt: number;
}

/**
 * InFlightTracker is the settle state machine, with no browser in it. It holds
 * the requests themselves, not a count, so a navigation forgets the previous
 * document's requests and a request that never reports back ages out.
 */
export class InFlightTracker<Key> {
  private readonly pending = new Map<Key, Pending>();
  private windowStartedAt: number;
  private lastSettledAt: number;

  constructor(
    private readonly settings: SettleConfig,
    now: number,
  ) {
    this.windowStartedAt = now;
    this.lastSettledAt = now;
  }

  started({
    key,
    url,
    resourceType,
    now,
  }: {
    key: Key;
    url: string;
    resourceType: string;
    now: number;
  }): void {
    if (shouldIgnoreRequest({ url, resourceType })) return;
    this.pending.set(key, { url, startedAt: now });
  }

  settled({ key, now }: { key: Key; now: number }): void {
    if (this.pending.delete(key)) this.lastSettledAt = now;
  }

  /** navigated forgets every request of the document being left: none of them reports now. */
  navigated(now: number): void {
    this.pending.clear();
    this.lastSettledAt = now;
  }

  /** begin opens a new settle window: a fresh deadline, the same requests. */
  begin(now: number): void {
    this.windowStartedAt = now;
  }

  /** inFlight lists the requests the settle still waits on. */
  inFlight(now: number): string[] {
    return [...this.pending.values()]
      .filter((request) => now - request.startedAt < LONG_LIVED_MILLIS)
      .map((request) => request.url);
  }

  /** longLived lists the requests old enough to be ignored as polls. */
  longLived(now: number): string[] {
    return [...this.pending.values()]
      .filter((request) => now - request.startedAt >= LONG_LIVED_MILLIS)
      .map((request) => request.url);
  }

  /**
   * decide reports quiet and expired. A caller stops on either: giving up at
   * the deadline keeps one polling screen from hanging a run of two hundred.
   */
  decide(now: number): SettleDecision {
    return {
      quiet:
        this.inFlight(now).length === 0 && now - this.quietSince(now) >= this.settings.quietMillis,
      expired: now - this.windowStartedAt >= this.settings.deadlineMillis,
    };
  }

  /** quietSince is when the last request settled or aged out, never before the window opened. */
  private quietSince(now: number): number {
    let since = Math.max(this.windowStartedAt, this.lastSettledAt);
    for (const request of this.pending.values()) {
      const agedOutAt = request.startedAt + LONG_LIVED_MILLIS;
      if (agedOutAt <= now) since = Math.max(since, agedOutAt);
    }
    return since;
  }
}
