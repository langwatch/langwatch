import {
  type ConnectedWorkspace,
  LangyLocalPresence,
  type PresenceHeartbeat,
} from "../langy-local-presence.repository.ts";
import type { LangyMemoryStore } from "./langy-memory.store.ts";

/** Which folder is shared with which conversation, for a process without Redis. */
export class LangyLocalPresenceMemoryRepository extends LangyLocalPresence {
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

  async read(conversationId: string): Promise<ConnectedWorkspace | null> {
    return this.store.presence.get(conversationId) ?? null;
  }

  async deregister(input: {
    conversationId: string;
    instanceId?: string;
  }): Promise<ConnectedWorkspace | null> {
    const held = this.store.presence.get(input.conversationId);
    if (!held) return null;
    if (input.instanceId && held.instanceId !== input.instanceId) return null;
    this.store.presence.delete(input.conversationId);
    return held;
  }

  async readPolicy(conversationId: string): Promise<boolean> {
    return this.store.presencePolicy.get(conversationId) ?? false;
  }

  async writePolicy(input: { conversationId: string; skipPermissions: boolean }): Promise<void> {
    this.store.presencePolicy.set(input.conversationId, input.skipPermissions);
  }
}
