import type { WorkspaceNudge } from "../rules/langy-local-call-record.rules.ts";

/** Stops one listener; resolves once the channel stopped delivering to it. */
export type Unsubscribe = () => Promise<void>;

/**
 * What one pod tells the pod holding a conversation's folder (ADR-129): a
 * call, a cancel, a permission answer, a policy change or a disconnect. A
 * listener hears only messages that read as a workspace nudge.
 */
export abstract class LangyLocalWorkspaceChannel {
  /** Nudges whichever pod listens for the conversation. */
  abstract nudge(input: { conversationId: string; nudge: WorkspaceNudge }): Promise<void>;

  abstract listen(input: {
    conversationId: string;
    onNudge: (nudge: WorkspaceNudge) => void;
  }): Promise<Unsubscribe>;

  /** Drops every listener and the connection that carried them. */
  abstract close(): Promise<void>;
}
