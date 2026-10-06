import { nowInstant } from "@langwatch/time";

import { GatewayBudgetChangeDedupeRepository } from "../gateway-budget-change-dedupe.repository.ts";

/** One claim per project per window, lapsing when the window does, as the Redis key expires. */
export class MemoryGatewayBudgetChangeDedupeRepository extends GatewayBudgetChangeDedupeRepository {
  static create(): MemoryGatewayBudgetChangeDedupeRepository {
    return new MemoryGatewayBudgetChangeDedupeRepository();
  }

  readonly #claimedUntil = new Map<string, number>();

  private constructor() {
    super();
  }

  async claimWindow(input: { projectId: string; windowSeconds: number }): Promise<boolean> {
    const now = nowInstant().epochMilliseconds;
    const until = this.#claimedUntil.get(input.projectId);
    if (until !== undefined && until > now) return false;
    this.#claimedUntil.set(input.projectId, now + input.windowSeconds * 1000);

    return true;
  }
}
