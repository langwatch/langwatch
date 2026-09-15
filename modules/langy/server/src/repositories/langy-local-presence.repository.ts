import { z } from "zod";
import { workspaceInfoSchema } from "@langwatch/langy-contract";

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
}
