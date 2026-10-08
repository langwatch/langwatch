// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** One Genie run's request budget and deadline. */

import { nowInstant } from "@langwatch/time";

/**
 * What one run will read before handing the rest to the next one. The walk is
 * three levels deep, so this counts HTTP requests rather than pages of one
 * feed: a workspace with hundreds of conversations must not turn a single run
 * into an unbounded crawl of the whole history.
 */
export const MAX_REQUESTS_PER_RUN = 400;

/**
 * Budgets one run's HTTP calls and its deadline in one place.
 *
 * Both limits mean the same thing to the caller — stop sweeping, keep what you
 * read, resume from the cursor — so they are one question rather than two
 * checks scattered through three nested loops.
 */
export class DatabricksGenieRunBudgetService {
  private requests = 0;
  private readonly maxRequests: number;

  private constructor(
    private readonly deadlineMs: number | undefined,
    maxRequests?: number,
  ) {
    this.maxRequests = maxRequests ?? MAX_REQUESTS_PER_RUN;
  }

  static create({
    deadlineMs,
    maxRequests,
  }: {
    deadlineMs: number | undefined;
    maxRequests?: number;
  }): DatabricksGenieRunBudgetService {
    return new DatabricksGenieRunBudgetService(deadlineMs, maxRequests);
  }

  spend(): void {
    this.requests += 1;
  }

  exhausted(): boolean {
    if (this.requests >= this.maxRequests) return true;
    return this.deadlineMs !== undefined && nowInstant().epochMilliseconds > this.deadlineMs;
  }

  /**
   * `exhausted`, asked on behalf of work that cannot be given up once it has
   * started: true when fewer than `reserveMs` of the deadline remain.
   *
   * `exhausted` is the wrong question before a long request. It only answers
   * once the deadline has ALREADY passed, and by then the worker has killed the
   * run and thrown away every event the sweep read — the request's own graceful
   * failure never gets to matter. Declining to start it is what keeps them.
   */
  exhaustedWithin(reserveMs: number): boolean {
    if (this.requests >= this.maxRequests) return true;
    return (
      this.deadlineMs !== undefined && nowInstant().epochMilliseconds + reserveMs > this.deadlineMs
    );
  }
}
