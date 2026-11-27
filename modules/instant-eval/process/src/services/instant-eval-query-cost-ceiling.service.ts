/**
 * One routed judged query's cost ceiling (ADR-190 decision 13): what its sends were billed plus
 * the worst cases held for the sends in flight never passes the ceiling, so neither does its spend.
 * A send that fits only once other holds settle waits for them, in the order asked. Per query.
 * @see specs/lwql/eval-functions.feature
 */

import type { InstantEvalJudgeCostCeiling } from "@langwatch/instant-eval-judge-contract";

type Waiter = {
  readonly nanoUsd: number;
  readonly resolve: (isHeld: boolean) => void;
  readonly detach: () => void;
};

export class InstantEvalQueryCostCeilingService implements InstantEvalJudgeCostCeiling {
  #heldNanoUsd = 0;
  #billedNanoUsd = 0;
  readonly #waiters: Waiter[] = [];
  readonly #ceilingNanoUsd: number;

  private constructor(ceilingNanoUsd: number) {
    this.#ceilingNanoUsd = ceilingNanoUsd;
  }

  /** A fresh ceiling for one query: nothing billed or held yet. */
  static create({
    ceilingNanoUsd,
  }: {
    ceilingNanoUsd: number;
  }): InstantEvalQueryCostCeilingService {
    return new InstantEvalQueryCostCeilingService(ceilingNanoUsd);
  }

  /** A worst case that is not a finite cost (an unpriced backend) is never held. */
  hold(nanoUsd: number, signal?: AbortSignal): Promise<boolean> {
    if (!Number.isFinite(nanoUsd) || nanoUsd < 0) return Promise.resolve(false);
    if (!this.#canEverFit(nanoUsd)) return Promise.resolve(false);
    if (this.#waiters.length === 0 && this.#fitsNow(nanoUsd)) {
      this.#heldNanoUsd += nanoUsd;
      return Promise.resolve(true);
    }
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise<boolean>((resolve, reject) => {
      const onAbort = () => {
        const at = this.#waiters.indexOf(waiter);
        if (at < 0) return;
        this.#waiters.splice(at, 1);
        reject(signal?.reason);
        this.#drain();
      };
      const waiter: Waiter = {
        nanoUsd,
        resolve,
        detach: () => signal?.removeEventListener("abort", onAbort),
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#waiters.push(waiter);
    });
  }

  settle({ heldNanoUsd, costNanoUsd }: { heldNanoUsd: number; costNanoUsd: number }): void {
    this.#heldNanoUsd = Math.max(0, this.#heldNanoUsd - heldNanoUsd);
    this.#billedNanoUsd += costNanoUsd;
    this.#drain();
  }

  /** Grants waiters in order; one that cannot fit even with nothing held is refused. */
  #drain(): void {
    while (this.#waiters.length > 0) {
      const waiter = this.#waiters[0]!;
      const isRefused = !this.#canEverFit(waiter.nanoUsd);
      if (!isRefused && !this.#fitsNow(waiter.nanoUsd)) return;
      this.#waiters.shift();
      waiter.detach();
      if (!isRefused) this.#heldNanoUsd += waiter.nanoUsd;
      waiter.resolve(!isRefused);
    }
  }

  #canEverFit(nanoUsd: number): boolean {
    return this.#billedNanoUsd + nanoUsd <= this.#ceilingNanoUsd;
  }

  #fitsNow(nanoUsd: number): boolean {
    return this.#billedNanoUsd + this.#heldNanoUsd + nanoUsd <= this.#ceilingNanoUsd;
  }
}
