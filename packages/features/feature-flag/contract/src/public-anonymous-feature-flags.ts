import { z } from "zod";

/**
 * The flags a signed-out browser may resolve.
 *
 * Deliberately separate from `FRONTEND_FEATURE_FLAGS` and deliberately
 * narrower. The authenticated map is bounded by who is asking; this one is
 * reachable by anybody on the internet, so its bound is this list and
 * nothing else. A key here leaks its own name and value to the public, so
 * adding one is a decision about disclosure, not just about rollout.
 *
 * Empty until a real pre-authentication caller exists. It is not a
 * placeholder to be filled in speculatively.
 *
 * A flag here must never gate authentication, entitlements, or anything a
 * signed-out visitor should not reach.
 */
export const PUBLIC_ANONYMOUS_FEATURE_FLAGS = [] as const;

export type PublicAnonymousFeatureFlag = (typeof PUBLIC_ANONYMOUS_FEATURE_FLAGS)[number];

/**
 * Every publicly resolvable flag, resolved for one anonymous browser.
 *
 * Keyed loosely because the allowlist is empty today: an exhaustive record
 * over `never` cannot express the map a non-empty allowlist produces. The
 * bound that matters is the allowlist itself, enforced where the map is
 * built.
 */
export const publicAnonymousFlagMapSchema = z.object({}).strict();

export type PublicAnonymousFlagMap = Record<string, boolean>;
