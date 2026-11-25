import type { InstanceGone, InstanceNudge, ReplyNudge } from "@langwatch/agent-contract";

/** Stops one listener; resolves once the store stopped delivering to it. */
export type Unsubscribe = () => Promise<void>;

/**
 * The relay's messages between pods (ADR-128): a call or cancel for an
 * instance, an ack or result for the calling pod, an instance gone. A
 * listener hears only messages that read as its schema.
 */
export abstract class ConnectedAgentRelayChannel {
  /** Whether messages reach the other app replicas, not only this process. */
  abstract readonly shared: boolean;

  /** Nudges the pods that hold an instance; resolves to how many listeners took it. */
  abstract nudgeInstance(input: {
    projectId: string;
    instanceId: string;
    nudge: InstanceNudge;
  }): Promise<number>;

  abstract listenToInstance(input: {
    projectId: string;
    instanceId: string;
    onNudge: (nudge: InstanceNudge) => void;
  }): Promise<Unsubscribe>;

  /** Tells the pod that placed a call its ack or result landed. */
  abstract nudgeReply(input: { podId: string; nudge: ReplyNudge }): Promise<void>;

  abstract listenForReplies(input: {
    podId: string;
    onReply: (nudge: ReplyNudge) => void;
  }): Promise<Unsubscribe>;

  /** Tells every pod an instance went away. */
  abstract announceInstanceGone(gone: InstanceGone): Promise<void>;

  abstract listenForInstanceGone(onGone: (gone: InstanceGone) => void): Promise<Unsubscribe>;

  /** Drops every listener and the connection that carried them. */
  abstract close(): Promise<void>;
}
