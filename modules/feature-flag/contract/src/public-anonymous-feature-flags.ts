import { z } from "zod";

/**
 * Flags a signed-out browser may resolve; deliberate subset (never gates
 * auth or entitlements).
 */
export const PUBLIC_ANONYMOUS_FEATURE_FLAGS = [] as const;

export type PublicAnonymousFeatureFlag = (typeof PUBLIC_ANONYMOUS_FEATURE_FLAGS)[number];

/**
 * Every publicly resolvable flag, resolved for one anonymous browser.
 * Keyed loosely since the allowlist is empty today (a `never` record
 * can't express a non-empty one); the real bound is enforced where the map is built.
 */
export const publicAnonymousFlagMapSchema = z.object({}).strict();

export type PublicAnonymousFlagMap = Record<string, boolean>;
