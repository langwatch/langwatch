// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { nowInstant } from "@langwatch/time";

import type {
  SaasRateLimitDecision,
  SaasRateLimitRepository,
} from "../saas-rate-limit.repository.ts";

/** The Redis limiter's memory twin: one fixed window per key, held in this process. */
export class MemorySaasRateLimitRepository implements SaasRateLimitRepository {
  static create(): MemorySaasRateLimitRepository {
    return new MemorySaasRateLimitRepository();
  }

  readonly #windows = new Map<string, { used: number; resetAt: number }>();

  check(
    key: string,
    limit: Readonly<{ requests: number; seconds: number }>,
  ): Promise<SaasRateLimitDecision> {
    const now = nowInstant().epochMilliseconds;
    const open = this.#windows.get(key);
    const window =
      open && open.resetAt > now ? open : { used: 0, resetAt: now + limit.seconds * 1000 };
    window.used += 1;
    this.#windows.set(key, window);
    if (window.used <= limit.requests) return Promise.resolve({ allowed: true });
    const retryAfterSeconds = Math.max(1, Math.ceil((window.resetAt - now) / 1000));
    return Promise.resolve({ allowed: false, retryAfterSeconds });
  }
}
