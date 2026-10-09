import type { ResolvedDataPrivacy } from "./data-privacy.ts";

/**
 * Folded privacy policies one request has already resolved, keyed by its
 * sorted project ids (ADR-144 decision 9). Lives on the request context and
 * dies with it, so it needs no invalidation: a member's rule change reaches
 * the next request. Kept apart from the policy service so the request context
 * factories can make one without loading the service.
 */
export type PrivacyPolicyRequestMemo = Map<string, Promise<ResolvedDataPrivacy>>;

export function newPrivacyPolicyRequestMemo(): PrivacyPolicyRequestMemo {
  return new Map();
}
