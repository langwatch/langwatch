/**
 * Which folder is shared with which conversation, right now (ADR-129). One
 * workspace per conversation; the record expires 30s after the last
 * heartbeat, so a sleeping machine reads offline with no explicit deregister.
 */

import { HandledError } from "@langwatch/handled-error";
import {
  CONNECT_TURN_OWED_TTL_MS,
  LangyLocalWorkspaceOfflineError,
  PRESENCE_TTL_MS,
} from "@langwatch/langy-contract";
import type { SessionStateStore } from "@langwatch/redis-client/session-state";
import { nowInstant } from "@langwatch/time";

import {
  owedConnectTurnKey,
  policyKey,
  presenceKey,
} from "../../rules/langy-local-control-keys.rules.ts";
import {
  connectedWorkspaceSchema,
  type ConnectedWorkspace,
  LangyLocalPresenceRepository,
  type OwedConnectTurn,
  type PresenceDeregistration,
  owedConnectTurnSchema,
  type PresenceHeartbeat,
} from "../langy-local-presence.repository.ts";

/** How long the skip choice outlives the socket that carried it. */
const POLICY_TTL_SECONDS = 6 * 60 * 60;

export interface LocalPresenceOptions {
  store: SessionStateStore;
  now?: () => number;
  presenceTtlMs?: number;
}

export class LangyLocalPresenceRedisRepository extends LangyLocalPresenceRepository {
  private readonly store: SessionStateStore;
  private readonly presenceTtlMs: number;
  readonly now: () => number;

  private constructor(options: LocalPresenceOptions) {
    super();
    this.store = options.store;
    this.now = options.now ?? (() => nowInstant().epochMilliseconds);
    this.presenceTtlMs = options.presenceTtlMs ?? PRESENCE_TTL_MS;
  }

  static create(options: LocalPresenceOptions): LangyLocalPresenceRedisRepository {
    return new LangyLocalPresenceRedisRepository(options);
  }

  /** Writes the folder as connected, replacing whatever was there. */
  async register(workspace: ConnectedWorkspace): Promise<void> {
    await this.store.set(
      presenceKey(workspace.conversationId),
      JSON.stringify(workspace),
      this.ttlSeconds(),
    );
  }

  /**
   * Refreshes the record on heartbeat, re-writing it if lapsed (TTL 30s vs a
   * 10s heartbeat, under a pod pause). A heartbeat from a replaced instance
   * answers "replaced" rather than restoring the old record.
   */
  async heartbeat(workspace: ConnectedWorkspace): Promise<PresenceHeartbeat> {
    const current = await this.getByConversationId(workspace.conversationId).catch(
      (error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "langy_local_workspace_offline") {
          return null;
        }
        throw error;
      },
    );
    if (current && current.instanceId !== workspace.instanceId) {
      return "replaced";
    }
    await this.register({
      ...(current ?? workspace),
      lastSeenAt: this.now(),
    });
    return current ? "refreshed" : "restored";
  }

  /** The folder connected to this conversation; throws `langy_local_workspace_offline` if none. */
  async getByConversationId(conversationId: string): Promise<ConnectedWorkspace> {
    const raw = await this.store.tryGet(presenceKey(conversationId));
    const parsed = raw ? parseConnectedWorkspace(raw) : null;
    // The key's own expiry is the primary clock. This second check is what
    // keeps a memory store, whose expiry a test drives by hand, honest.
    if (!parsed || this.now() - parsed.lastSeenAt > this.presenceTtlMs) {
      throw new LangyLocalWorkspaceOfflineError({ conversationId });
    }
    return parsed;
  }

  /**
   * Clears the record, but only when the caller still holds it. The instance
   * check is what stops a late close, from a socket that was already replaced,
   * from disconnecting the folder that took its place.
   */
  async deregister({
    conversationId,
    instanceId,
  }: {
    conversationId: string;
    instanceId?: string;
  }): Promise<PresenceDeregistration> {
    const current = await this.getByConversationId(conversationId).catch((error: unknown) => {
      if (HandledError.isHandled(error) && error.code === "langy_local_workspace_offline") {
        return null;
      }
      throw error;
    });
    if (!current) return { cleared: false };
    if (instanceId && current.instanceId !== instanceId) return { cleared: false };
    await this.store.del(presenceKey(conversationId));
    await this.store.del(policyKey(conversationId));
    await this.store.del(owedConnectTurnKey(conversationId));
    return { cleared: true, workspace: current };
  }

  /** Whether the permission cards are off for this conversation. */
  async readPolicy(conversationId: string): Promise<boolean> {
    return (await this.store.tryGet(policyKey(conversationId))) === "1";
  }

  /** Records the developer's choice about the permission cards. */
  async writePolicy({
    conversationId,
    skipPermissions,
  }: {
    conversationId: string;
    skipPermissions: boolean;
  }): Promise<void> {
    if (!skipPermissions) {
      await this.store.del(policyKey(conversationId));
      return;
    }
    await this.store.set(policyKey(conversationId), "1", POLICY_TTL_SECONDS);
  }

  async oweConnectTurn({
    conversationId,
    ...owed
  }: Omit<OwedConnectTurn, "owedAt"> & { conversationId: string }): Promise<void> {
    const record: OwedConnectTurn = { ...owed, owedAt: this.now() };
    await this.store.set(
      owedConnectTurnKey(conversationId),
      JSON.stringify(record),
      Math.ceil(CONNECT_TURN_OWED_TTL_MS / 1000),
    );
  }

  async readOwedConnectTurn(conversationId: string): Promise<OwedConnectTurn | null> {
    const raw = await this.store.tryGet(owedConnectTurnKey(conversationId));
    if (!raw) return null;
    const parsed = parseOwedConnectTurn(raw);
    return parsed;
  }

  async settleOwedConnectTurn(conversationId: string): Promise<void> {
    await this.store.del(owedConnectTurnKey(conversationId));
  }

  private ttlSeconds(): number {
    return Math.ceil(this.presenceTtlMs / 1000);
  }
}

function parseConnectedWorkspace(raw: string): ConnectedWorkspace | null {
  try {
    const parsed = connectedWorkspaceSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function parseOwedConnectTurn(raw: string): OwedConnectTurn | null {
  try {
    const parsed = owedConnectTurnSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
