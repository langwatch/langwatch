import type {
  LangyUiActionRepository,
  PendingUiAction,
} from "../repositories/langy-ui-action.repository.ts";
import { UI_ACTION_CLAIM_TTL_SECONDS, type UiActionCompletion } from "./langy-ui-action.service.ts";

const RESULT_TTL_SECONDS = 30;
/** A page result bigger than this is a bug, not a payload. */
const MAX_RESULT_BYTES = 64 * 1024;

/**
 * The page half of the agent-to-page action channel: a tab claiming a published action and
 * reporting its outcome. Spec: specs/langy/langy-ui-actions.feature
 */
export class LangyUiActionPageService {
  static create(deps: { uiActions: LangyUiActionRepository }): LangyUiActionPageService {
    return new LangyUiActionPageService(deps.uiActions);
  }

  private constructor(private readonly uiActions: LangyUiActionRepository) {}

  /**
   * The page asking to execute `actionId`. First caller wins (SET NX); every other tab, every
   * stream replay, and a tab racing the dispatch's own handover to the backend gets `isClaimed:
   * false` and drops.
   */
  async claim({
    projectId,
    userId,
    conversationId,
    actionId,
  }: {
    projectId: string;
    userId: string;
    conversationId: string;
    actionId: string;
  }): Promise<{ isClaimed: boolean }> {
    const pending = await this.readPending(actionId);
    if (!pending || pending.projectId !== projectId || pending.conversationId !== conversationId) {
      return { isClaimed: false };
    }

    return this.uiActions.claim({
      actionId,
      claimant: userId,
      ttlSeconds: UI_ACTION_CLAIM_TTL_SECONDS,
    });
  }

  /**
   * The page reporting the claimed action's outcome.
   */
  async complete({
    projectId,
    userId,
    conversationId,
    actionId,
    completion,
  }: {
    projectId: string;
    userId: string;
    conversationId: string;
    actionId: string;
    completion: UiActionCompletion;
  }): Promise<{ isAccepted: boolean }> {
    const pending = await this.readPending(actionId);
    if (!pending || pending.projectId !== projectId || pending.conversationId !== conversationId) {
      return { isAccepted: false };
    }

    if (!(await this.uiActions.isClaimedBy({ actionId, claimant: userId }))) {
      return { isAccepted: false };
    }

    const raw = JSON.stringify(completion);
    // Measure what Redis stores: a string's length counts UTF-16 code units,
    // so a result of multi-byte characters passes a length check at up to
    // three times the ceiling.
    const stored =
      Buffer.byteLength(raw, "utf8") > MAX_RESULT_BYTES
        ? JSON.stringify({ ok: false, errorCode: "result_too_large" } satisfies UiActionCompletion)
        : raw;
    await this.uiActions.pushResult({ actionId, raw: stored, ttlSeconds: RESULT_TTL_SECONDS });
    await this.uiActions.dropPending(actionId);

    return { isAccepted: true };
  }

  private async readPending(actionId: string): Promise<PendingUiAction | undefined> {
    const read = await this.uiActions.readPending(actionId);
    return read.kind === "hit" ? read.pending : undefined;
  }
}
