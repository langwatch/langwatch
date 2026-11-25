/**
 * One routed judged query's cost ceiling (ADR-190 decision 13): what its sends were billed plus
 * the worst cases held for the sends in flight never passes the ceiling, so neither does its spend.
 * @see specs/lwql/eval-functions.feature
 */

import type { InstantEvalJudgeCostCeiling } from "@langwatch/instant-eval-judge-contract";

export class InstantEvalQueryCostCeilingService implements InstantEvalJudgeCostCeiling {
  #heldNanoUsd = 0;
  #billedNanoUsd = 0;

  private constructor(private readonly ceilingNanoUsd: number) {}

  static create({
    ceilingNanoUsd,
  }: {
    ceilingNanoUsd: number;
  }): InstantEvalQueryCostCeilingService {
    return new InstantEvalQueryCostCeilingService(ceilingNanoUsd);
  }

  /** A worst case that is not a finite cost (an unpriced backend) is never held. */
  hold(nanoUsd: number): boolean {
    if (!Number.isFinite(nanoUsd) || nanoUsd < 0) return false;
    if (this.#billedNanoUsd + this.#heldNanoUsd + nanoUsd > this.ceilingNanoUsd) return false;
    this.#heldNanoUsd += nanoUsd;
    return true;
  }

  settle({ heldNanoUsd, costNanoUsd }: { heldNanoUsd: number; costNanoUsd: number }): void {
    this.#heldNanoUsd = Math.max(0, this.#heldNanoUsd - heldNanoUsd);
    this.#billedNanoUsd += costNanoUsd;
  }
}
