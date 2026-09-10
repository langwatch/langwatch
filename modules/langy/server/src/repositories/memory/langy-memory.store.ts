import type { ConnectedWorkspace } from "../langy-local-presence.repository.ts";
import type { LangyStreamRead } from "../langy-token-buffer.repository.ts";
import type { LangyTurnAccess, LangyTurnHandoff } from "../langy-live-turn.repository.ts";
import type { LangyAnalyticsEventRecord } from "../langy-analytics-event.repository.ts";

/**
 * The one process-local store every memory repository reads and writes, so a
 * row written through one is the row another answers with - the way a single
 * Redis connection serves the live edge in a deployment that has one.
 */
export class LangyMemoryStore {
  readonly turnAccess = new Map<string, LangyTurnAccess>();
  readonly handoffs = new Map<string, LangyTurnHandoff>();
  readonly stoppedTurns = new Set<string>();
  readonly seenFrames = new Set<string>();
  readonly resourceLinks = new Map<string, Map<string, string>>();
  readonly presence = new Map<string, ConnectedWorkspace>();
  readonly presencePolicy = new Map<string, boolean>();
  readonly streams = new Map<string, LangyStreamRead[]>();
  readonly endedStreams = new Set<string>();
  readonly heartbeats = new Map<string, number>();
  readonly analyticsEvents: LangyAnalyticsEventRecord[] = [];

  static create(): LangyMemoryStore {
    return new LangyMemoryStore();
  }

  /** The key every per-turn row is filed under. */
  turnKey(input: { conversationId: string; turnId: string }): string {
    return `${input.conversationId}:${input.turnId}`;
  }
}
