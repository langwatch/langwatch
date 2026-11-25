/**
 * The throttle middleware: a per-procedure, per-principal window counted
 * through the process's rate limiter, after the check resolves the caller and
 * before the trail, so a refused call writes no audit row.
 */
import type { MiddlewareResult } from "@trpc/server/unstable-core-do-not-import";

import { RateLimitedError } from "../errors.ts";

/** The window one caller may ask one procedure inside. */
export type TrpcThrottlePolicy = Readonly<{ requests: number; seconds: number }>;

/** What one throttle decision says. Structurally the api port's decision. */
export type TrpcThrottleDecision = Readonly<{
  allowed: boolean;
  retryAfterSeconds?: number;
}>;

/**
 * What the process supplies for a procedure to be throttled. `policyFor` is
 * async because the follow-up resolves a caller's tier into its policy; an
 * operation the map does not name passes through untouched.
 */
export type TrpcThrottle<TContext> = Readonly<{
  policyFor(input: { procedure: string; ctx: TContext }): Promise<TrpcThrottlePolicy | undefined>;
  /** Who the counter counts: the actor the check resolved, else the address. */
  principalOf(ctx: TContext): string;
  check(input: { key: string; policy: TrpcThrottlePolicy }): Promise<TrpcThrottleDecision>;
}>;

/**
 * The middleware itself, root-agnostic like its siblings in `runtime.ts`. tRPC
 * gives a middleware no header seam, so the retry-after stays off the wire and
 * the earlier `handledError` translates the refusal to TOO_MANY_REQUESTS.
 */
export function trpcThrottle<TContext>(throttle: TrpcThrottle<TContext>) {
  return async ({
    ctx,
    path,
    next,
  }: {
    ctx: TContext;
    path: string;
    next: () => Promise<MiddlewareResult<object>>;
  }): Promise<MiddlewareResult<object>> => {
    const policy = await throttle.policyFor({ procedure: path, ctx });

    if (!policy) return next();

    const key = `throttle:${path}:${throttle.principalOf(ctx)}`;
    const decision = await throttle.check({ key, policy });

    if (decision.allowed) return next();

    throw new RateLimitedError();
  };
}
