import { nowInstant } from "@langwatch/time";

import {
  type UserRateLimitBudget,
  type UserRateLimitDecision,
  UserRateLimitRepository,
} from "../user-rate-limit.repository.ts";

/** The Redis counter's memory twin: one fixed window per key, held in this process. */
export class MemoryUserRateLimitRepository extends UserRateLimitRepository {
  static create(): MemoryUserRateLimitRepository {
    return new MemoryUserRateLimitRepository();
  }

  readonly #windows = new Map<string, { used: number; resetAt: number }>();

  private constructor() {
    super();
  }

  check(input: UserRateLimitBudget): Promise<UserRateLimitDecision> {
    const now = nowInstant().epochMilliseconds;
    const open = this.#windows.get(input.key);
    const window =
      open && open.resetAt > now ? open : { used: 0, resetAt: now + input.windowSeconds * 1000 };
    window.used += 1;
    this.#windows.set(input.key, window);

    return Promise.resolve({ allowed: window.used <= input.max, resetAt: window.resetAt });
  }
}
