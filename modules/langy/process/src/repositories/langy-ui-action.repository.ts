/** What a published action's pending record pins: where the action belongs. */
export interface PendingUiAction {
  projectId: string;
  conversationId: string;
  turnId: string;
  kind: string;
}

/** The pending record of one action, or its absence (lapsed, completed, or never published). */
export type LangyUiActionPendingRead = { kind: "hit"; pending: PendingUiAction } | { kind: "miss" };

/** One blocking wait on an action's result list, over a connection it holds until released. */
export interface LangyUiActionResultWait {
  /** The next result pushed for `actionId`, or a timeout after `timeoutSeconds`. */
  next(input: {
    actionId: string;
    timeoutSeconds: number;
  }): Promise<{ kind: "result"; raw: string } | { kind: "timeout" }>;
  release(): void;
}

/**
 * The agent-to-page action channel's rows: the pending record a page
 * validates, the one claim a page and the backend contend for, and the result
 * list the dispatch waits on. Spec: specs/langy/langy-ui-actions.feature
 */
export abstract class LangyUiActionRepository {
  abstract publishPending(input: {
    actionId: string;
    pending: PendingUiAction;
    ttlSeconds: number;
  }): Promise<void>;

  abstract readPending(actionId: string): Promise<LangyUiActionPendingRead>;

  abstract dropPending(actionId: string): Promise<void>;

  /** First caller wins; every later caller is refused until the claim lapses. */
  abstract claim(input: {
    actionId: string;
    claimant: string;
    ttlSeconds: number;
  }): Promise<{ isClaimed: boolean }>;

  abstract isClaimedBy(input: { actionId: string; claimant: string }): Promise<boolean>;

  abstract pushResult(input: { actionId: string; raw: string; ttlSeconds: number }): Promise<void>;

  /** Opens a wait that holds its own connection, so a blocking pop never wedges the shared one. */
  abstract openResultWait(): LangyUiActionResultWait;
}
