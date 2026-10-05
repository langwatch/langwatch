import type { StoredProjection } from "@langwatch/eventing";
import type {
  LangyConversationStateData,
  LangyConversationTurnData,
  LangyMessageProjectionRecord,
} from "@langwatch/langy-contract";
import type { Instant } from "@langwatch/time";

import type { LangyAnalyticsEventRecord } from "../langy-analytics-event.repository.ts";
import type { LangyTurnAccess, LangyTurnHandoff } from "../langy-live-turn.repository.ts";
import type { ConnectedWorkspace, OwedConnectTurn } from "../langy-local-presence.repository.ts";
import type { LangyStreamRead } from "../langy-token-buffer.repository.ts";
import type { PendingUiAction } from "../langy-ui-action.repository.ts";

/** One logical send's receipt, as the `LangyTurnRequest` table holds it. */
export interface LangyMemoryTurnRequest {
  projectId: string;
  userId: string;
  requestId: string;
  conversationId: string;
  turnId: string;
  status: string;
  leaseOwner: string;
  leaseExpiresAt: number;
}

/** A conversation's one active turn, as the `LangyActiveTurn` table holds it. */
export interface LangyMemoryActiveTurn {
  projectId: string;
  conversationId: string;
  turnId: string;
  requestId: string;
  userId: string;
  status: string;
  leaseOwner: string;
  leaseExpiresAt: number;
  updatedAt: number;
}

/** The project facts the credential and session-key reads look up. */
export interface LangyMemoryProject {
  teamId: string;
  organizationId: string;
  egressAllowlist: unknown;
}

/** An API key as the session-key reads and the reap see it. */
export interface LangyMemoryApiKey {
  id: string;
  name: string;
  revokedAt: Instant | null;
  expiresAt: Instant | null;
  /** The projects a role binding scopes the key to. */
  projectIds: string[];
}

/** A virtual key as the credential read sees it. */
export interface LangyMemoryVirtualKey {
  organizationId: string;
  purpose: string;
  status: string;
  projectIds: string[];
  updatedAt: number;
  config: unknown;
}

/**
 * The one process-local store every memory repository reads and writes, so a
 * row written through one is the row another answers with - the way a single
 * Redis connection and one database serve them in a deployment.
 */
export class LangyMemoryStore {
  readonly turnAccess = new Map<string, LangyTurnAccess>();
  readonly handoffs = new Map<string, LangyTurnHandoff>();
  readonly stoppedTurns = new Set<string>();
  readonly seenFrames = new Set<string>();
  readonly resourceLinks = new Map<string, Map<string, string>>();
  readonly presence = new Map<string, ConnectedWorkspace>();
  readonly presencePolicy = new Map<string, boolean>();
  readonly owedConnectTurns = new Map<string, OwedConnectTurn>();
  readonly streams = new Map<string, LangyStreamRead[]>();
  readonly endedStreams = new Set<string>();
  readonly heartbeats = new Map<string, number>();
  readonly analyticsEvents: LangyAnalyticsEventRecord[] = [];
  /** Keyed `projectId:conversationId`. */
  readonly conversations = new Map<
    string,
    { projectId: string; projection: StoredProjection<LangyConversationStateData> }
  >();
  /** Keyed `projectId:conversationId:turnId`. */
  readonly turns = new Map<
    string,
    { projectId: string; projection: StoredProjection<LangyConversationTurnData> }
  >();
  /** Keyed `projectId:conversationId:messageId`. */
  readonly messages = new Map<
    string,
    { projectId: string; record: LangyMessageProjectionRecord }
  >();
  /** Keyed `projectId:userId:requestId`. */
  readonly turnRequests = new Map<string, LangyMemoryTurnRequest>();
  /** Keyed `projectId:conversationId`. */
  readonly activeTurns = new Map<string, LangyMemoryActiveTurn>();
  readonly projects = new Map<string, LangyMemoryProject>();
  readonly apiKeys = new Map<string, LangyMemoryApiKey>();
  readonly virtualKeys: LangyMemoryVirtualKey[] = [];
  /** The ui-action channel's rows, keyed by action id, each with its expiry. */
  readonly uiActionPending = new Map<string, { value: PendingUiAction; expiresAt: number }>();
  readonly uiActionClaims = new Map<string, { value: string; expiresAt: number }>();
  readonly uiActionResults = new Map<string, { value: string[]; expiresAt: number }>();

  static create(): LangyMemoryStore {
    return new LangyMemoryStore();
  }

  /** The key every per-turn row is filed under. */
  turnKey(input: { conversationId: string; turnId: string }): string {
    return `${input.conversationId}:${input.turnId}`;
  }
}
