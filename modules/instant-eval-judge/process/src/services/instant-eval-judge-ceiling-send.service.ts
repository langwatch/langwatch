/**
 * One send under a query's cost ceiling (ADR-190 decision 13): hold its worst case, send, and
 * settle the hold at what the send billed, also when the send throws. A send whose usage never
 * came back settles at its whole hold: the provider charged it, but nobody knows how much.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import type { InstantEvalJudgeCostCeiling } from "@langwatch/instant-eval-judge-contract";
import type { Logger } from "@langwatch/observability";

/** A send the ceiling refused sent nothing; a held one carries what the send returned. */
export type InstantEvalJudgeCeilingSent<T> =
  | { readonly isHeld: false }
  | { readonly isHeld: true; readonly value: T };

export class InstantEvalJudgeCeilingSendService {
  private constructor(
    private readonly costCeiling: InstantEvalJudgeCostCeiling,
    private readonly logger: Pick<Logger, "error">,
  ) {}

  static create({
    costCeiling,
    logger,
  }: {
    costCeiling: InstantEvalJudgeCostCeiling;
    logger: Pick<Logger, "error">;
  }): InstantEvalJudgeCeilingSendService {
    return new InstantEvalJudgeCeilingSendService(costCeiling, logger);
  }

  /**
   * `send` reports what it bills through `bill`, and a call that went out with no usage back
   * through `unread`; a send billed past its hold logs at error.
   */
  async send<T>({
    heldNanoUsd,
    signal,
    backend,
    send,
  }: {
    heldNanoUsd: number;
    signal: AbortSignal | undefined;
    /** Which backend the send goes to, for the over-hold log. */
    backend: string;
    send: (bill: (costNanoUsd: number) => void, unread: () => void) => Promise<T>;
  }): Promise<InstantEvalJudgeCeilingSent<T>> {
    if (!(await this.costCeiling.hold(heldNanoUsd, signal))) return { isHeld: false };
    let costNanoUsd = 0;
    let isUsageUnread = false;
    try {
      const value = await send(
        (cost) => {
          costNanoUsd += cost;
        },
        () => {
          isUsageUnread = true;
        },
      );
      return { isHeld: true, value };
    } finally {
      // Counted on the ceiling, never billed: the customer pays only for usage read back.
      const countedNanoUsd = isUsageUnread ? Math.max(heldNanoUsd, costNanoUsd) : costNanoUsd;
      this.costCeiling.settle({ heldNanoUsd, costNanoUsd: countedNanoUsd });
      if (costNanoUsd > heldNanoUsd) {
        this.logger.error(
          { backend, heldNanoUsd, costNanoUsd },
          "Instant Evals send cost more than its worst case; the query ceiling under-held",
        );
      }
    }
  }
}
