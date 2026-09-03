/**
 * Which folder is shared with which conversation, right now (ADR-129).
 *
 * One workspace per conversation, and the record dies on its own thirty
 * seconds after the last heartbeat, so a machine that went to sleep reads
 * offline without anything having to notice. A Ctrl-C does not wait for that:
 * the command line deregisters and the gateway clears the record at once.
 *
 * The workspace description rides in the record, so a card, a chip and the
 * `code_access` tool all read the folder, the machine and the branch from one
 * place.
 */

import { z } from "zod";
import type { AgentStateStore } from "~/server/connected-agents/state-store";
import { PRESENCE_TTL_MS } from "./constants";
import { policyKey, presenceKey } from "./keys";
import { workspaceInfoSchema } from "./protocol";

/** How long the skip choice outlives the socket that carried it. */
const POLICY_TTL_SECONDS = 6 * 60 * 60;

export const connectedWorkspaceSchema = z.object({
  conversationId: z.string(),
  projectId: z.string(),
  /** The user who approved the control request this folder connected on. */
  userId: z.string(),
  requestId: z.string(),
  instanceId: z.string(),
  hostname: z.string(),
  connectedAt: z.number(),
  lastSeenAt: z.number(),
  workspace: workspaceInfoSchema,
});
export type ConnectedWorkspace = z.infer<typeof connectedWorkspaceSchema>;

export interface LocalPresenceOptions {
  store: AgentStateStore;
  now?: () => number;
  presenceTtlMs?: number;
}

export class LocalWorkspacePresence {
  private readonly store: AgentStateStore;
  private readonly presenceTtlMs: number;
  readonly now: () => number;

  constructor(options: LocalPresenceOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => Date.now());
    this.presenceTtlMs = options.presenceTtlMs ?? PRESENCE_TTL_MS;
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
   * Refreshes the record on a heartbeat. A heartbeat from an instance that no
   * longer holds the record is ignored, so a socket that lost the folder to a
   * newer share cannot keep the old one alive.
   */
  async heartbeat({
    conversationId,
    instanceId,
  }: {
    conversationId: string;
    instanceId: string;
  }): Promise<boolean> {
    const current = await this.read(conversationId);
    if (!current || current.instanceId !== instanceId) return false;
    await this.register({ ...current, lastSeenAt: this.now() });
    return true;
  }

  /** The folder connected to this conversation, or nothing when none is. */
  async read(conversationId: string): Promise<ConnectedWorkspace | null> {
    const raw = await this.store.get(presenceKey(conversationId));
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
    return (await this.store.get(policyKey(conversationId))) === "1";
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
