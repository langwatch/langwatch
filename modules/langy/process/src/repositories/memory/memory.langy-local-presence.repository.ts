import { LangyLocalWorkspaceOfflineError } from "@langwatch/langy-contract";
import { nowInstant } from "@langwatch/time";

import {
  type ConnectedWorkspace,
  LangyLocalPresenceRepository,
  type OwedConnectTurn,
  type OwedConnectTurnLookup,
  type PresenceDeregistration,
  type PresenceHeartbeat,
} from "../langy-local-presence.repository.ts";
import type { LangyMemoryStore } from "./langy-memory.store.ts";

/** Which folder is shared with which conversation, for a process without Redis. */
export class LangyLocalPresenceMemoryRepository extends LangyLocalPresenceRepository {
  private constructor(private readonly store: LangyMemoryStore) {
    super();
  }

  static create(store: LangyMemoryStore): LangyLocalPresenceMemoryRepository {
    return new LangyLocalPresenceMemoryRepository(store);
  }

  async register(workspace: ConnectedWorkspace): Promise<void> {
    this.store.presence.set(workspace.conversationId, workspace);
  }

  async heartbeat(workspace: ConnectedWorkspace): Promise<PresenceHeartbeat> {
    const held = this.store.presence.get(workspace.conversationId);
    if (!held) {
      this.store.presence.set(workspace.conversationId, workspace);
      return "restored";
    }
    if (held.instanceId !== workspace.instanceId) return "replaced";
    this.store.presence.set(workspace.conversationId, workspace);
    return "refreshed";
  }

  async getByConversationId(conversationId: string): Promise<ConnectedWorkspace> {
    const held = this.store.presence.get(conversationId);
    if (!held) throw new LangyLocalWorkspaceOfflineError({ conversationId });
    return held;
  }

  async deregister(input: {
    conversationId: string;
    instanceId?: string;
  }): Promise<PresenceDeregistration> {
    const held = this.store.presence.get(input.conversationId);
    if (!held) return { cleared: false };
    if (input.instanceId && held.instanceId !== input.instanceId) return { cleared: false };
    this.store.presence.delete(input.conversationId);
    this.store.owedConnectTurns.delete(input.conversationId);
    return { cleared: true, workspace: held };
  }

  async readPolicy(conversationId: string): Promise<boolean> {
    return this.store.presencePolicy.get(conversationId) ?? false;
  }

  async writePolicy(input: { conversationId: string; skipPermissions: boolean }): Promise<void> {
    this.store.presencePolicy.set(input.conversationId, input.skipPermissions);
  }

  async oweConnectTurn({
    conversationId,
    ...owed
  }: Omit<OwedConnectTurn, "owedAt"> & { conversationId: string }): Promise<void> {
    this.store.owedConnectTurns.set(conversationId, {
      ...owed,
      owedAt: nowInstant().epochMilliseconds,
    });
  }

  async readOwedConnectTurn(conversationId: string): Promise<OwedConnectTurnLookup> {
    const owed = this.store.owedConnectTurns.get(conversationId);
    return owed === undefined ? { kind: "miss" } : { kind: "hit", owed };
  }

  async settleOwedConnectTurn(conversationId: string): Promise<void> {
    this.store.owedConnectTurns.delete(conversationId);
  }
}
