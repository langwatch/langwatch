/**
 * Which folder is shared with which conversation, right now (ADR-129). One
 * workspace per conversation; the record expires 30s after the last
 * heartbeat, so a sleeping machine reads offline with no explicit deregister.
 */

import type { AgentStateStorePort } from "@langwatch/agent-contract";
import { PRESENCE_TTL_MS } from "@langwatch/langy-contract";
import { policyKey, presenceKey } from "../rules/langy-local-control-keys.rules.ts";
import {
  connectedWorkspaceSchema,
  type ConnectedWorkspace,
  LangyLocalPresencePort,
  type PresenceHeartbeat,
} from "../ports/langy-local-presence.port.ts";

/** How long the skip choice outlives the socket that carried it. */
const POLICY_TTL_SECONDS = 6 * 60 * 60;

export interface LocalPresenceOptions {
  store: AgentStateStorePort;
  now?: () => number;
  presenceTtlMs?: number;
}

export class LangyLocalPresenceAdapter extends LangyLocalPresencePort {
  private readonly store: AgentStateStorePort;
  private readonly presenceTtlMs: number;
  readonly now: () => number;

  private constructor(options: LocalPresenceOptions) {
    super();
    this.store = options.store;
    this.now = options.now ?? (() => Date.now());
    this.presenceTtlMs = options.presenceTtlMs ?? PRESENCE_TTL_MS;
  }

  static create(options: LocalPresenceOptions): LangyLocalPresenceAdapter {
    return new LangyLocalPresenceAdapter(options);
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
    const current = await this.read(workspace.conversationId);
    if (current && current.instanceId !== workspace.instanceId) {
      return "replaced";
    }
    await this.register({
      ...(current ?? workspace),
      lastSeenAt: this.now(),
    });
    return current ? "refreshed" : "restored";
  }

  /** The folder connected to this conversation, or nothing when none is. */
  async read(conversationId: string): Promise<ConnectedWorkspace | null> {
    const raw = await this.store.tryGet(presenceKey(conversationId));
    if (!raw) return null;
    const parsed = safeParse(raw);
    if (!parsed) return null;
    // The key's own expiry is the primary clock. This second check is what
    // keeps a memory store, whose expiry a test drives by hand, honest.
    if (this.now() - parsed.lastSeenAt > this.presenceTtlMs) return null;
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
  }): Promise<ConnectedWorkspace | null> {
    const current = await this.read(conversationId);
    if (!current) return null;
    if (instanceId && current.instanceId !== instanceId) return null;
    await this.store.del(presenceKey(conversationId));
    await this.store.del(policyKey(conversationId));
    return current;
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

  private ttlSeconds(): number {
    return Math.ceil(this.presenceTtlMs / 1000);
  }
}

function safeParse(raw: string): ConnectedWorkspace | null {
  try {
    const parsed = connectedWorkspaceSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
