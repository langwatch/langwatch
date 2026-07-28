export type LangyTurnAdmissionClaim =
  | {
      kind: "claimed";
      claimToken: string;
      conversationId: string;
      turnId: string;
    }
  | {
      kind: "replay";
      conversationId: string;
      turnId: string;
    }
  | { kind: "pending" }
  | { kind: "busy" }
  /**
   * The idempotency key exists but was admitted with DIFFERENT content: the
   * derived turn id no longer matches the receipt's. Callers must error —
   * silently replaying the original send would swallow the new content.
   */
  | { kind: "mismatch" };

export interface LangyTurnAdmissionRepository {
  claim(input: {
    projectId: string;
    userId: string;
    idempotencyKey: string;
    conversationId: string;
    turnId: string;
  }): Promise<LangyTurnAdmissionClaim>;

  commit(input: {
    projectId: string;
    userId: string;
    idempotencyKey: string;
    conversationId: string;
    turnId: string;
    claimToken: string;
  }): Promise<void>;

  /** Canonical-event recovery when the request process dies before commit(). */
  confirmAccepted(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
  }): Promise<void>;

  abort(input: {
    projectId: string;
    userId: string;
    idempotencyKey: string;
    conversationId: string;
    turnId: string;
    claimToken: string;
  }): Promise<void>;

  release(input: {
    projectId: string;
    conversationId: string;
    turnId?: string;
  }): Promise<void>;
}

/** Tests and deliberately disabled apps still need the same application seam. */
export class NullLangyTurnAdmissionRepository
  implements LangyTurnAdmissionRepository
{
  async claim(input: {
    conversationId: string;
    turnId: string;
  }): Promise<LangyTurnAdmissionClaim> {
    return {
      kind: "claimed",
      claimToken: crypto.randomUUID(),
      conversationId: input.conversationId,
      turnId: input.turnId,
    };
  }

  async commit(): Promise<void> {}
  async confirmAccepted(): Promise<void> {}
  async abort(): Promise<void> {}
  async release(): Promise<void> {}
}
