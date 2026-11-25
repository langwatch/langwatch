/** One fixed-window budget: at most `max` attempts per `windowSeconds`. */
export type UserRateLimitBudget = Readonly<{ key: string; windowSeconds: number; max: number }>;

/** What one metered attempt is told; `resetAt` is when the window reopens, in epoch ms. */
export type UserRateLimitDecision = Readonly<{ allowed: boolean; resetAt: number }>;

/** The fixed-window counters behind sign-up, first-password and avatar-upload throttles. */
export abstract class UserRateLimitRepository {
  /** Counts one attempt against `key` in the caller's own window. */
  abstract check(input: UserRateLimitBudget): Promise<UserRateLimitDecision>;
}
