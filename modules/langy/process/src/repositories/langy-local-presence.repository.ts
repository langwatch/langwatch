import { workspaceInfoSchema } from "@langwatch/langy-contract";
import { z } from "zod";

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

/**
 * What one heartbeat did: it moved the record on, it wrote a lapsed record
 * back, or it found the conversation shared by a newer connection and left it
 * alone.
 */
export type PresenceHeartbeat = "refreshed" | "restored" | "replaced";

/** The connect turn a folder is owed, and whose turn it is started as. */
export const owedConnectTurnSchema = z.object({
  projectId: z.string(),
  userId: z.string(),
  requestId: z.string(),
  owedAt: z.number(),
});
export type OwedConnectTurn = z.infer<typeof owedConnectTurnSchema>;

/**
 * Which folder is shared with which conversation, right now (ADR-129). A
 * service depends on this abstract surface, never on the concrete Redis or
 * memory adapter behind it.
 */
export abstract class LangyLocalPresence {
  /** Writes the folder as connected, replacing whatever was there. */
  abstract register(workspace: ConnectedWorkspace): Promise<void>;

  /** Refreshes the record on a heartbeat, and writes it again when it is gone. */
  abstract heartbeat(workspace: ConnectedWorkspace): Promise<PresenceHeartbeat>;

  /** The folder connected to this conversation, or nothing when none is. */
  abstract read(conversationId: string): Promise<ConnectedWorkspace | null>;

  /** Clears the record, but only when the caller still holds it. */
  abstract deregister(input: {
    conversationId: string;
    instanceId?: string;
  }): Promise<ConnectedWorkspace | null>;

  /** Whether the permission cards are off for this conversation. */
  abstract readPolicy(conversationId: string): Promise<boolean>;

  /** Records the developer's choice about the permission cards. */
  abstract writePolicy(input: { conversationId: string; skipPermissions: boolean }): Promise<void>;

  /**
   * Records that the folder is owed the turn that says it is connected: the
   * terminal connected while the turn before still read as in flight, so
   * that turn's end is what starts it.
   */
  abstract oweConnectTurn(
    input: Omit<OwedConnectTurn, "owedAt"> & { conversationId: string },
  ): Promise<void>;

  /** The connect turn this folder is owed, or nothing when none is. */
  abstract readOwedConnectTurn(conversationId: string): Promise<OwedConnectTurn | null>;

  /**
   * Forgets the owed turn: a turn placed a call on the folder, the owed turn
   * started, or the folder is gone.
   */
  abstract settleOwedConnectTurn(conversationId: string): Promise<void>;
}
