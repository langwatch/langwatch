/**
 * The seat kinds a licence limits, keyed by the labels and the refusal below.
 * Organization owns the limit check and its wire schemas (organization-contract
 * `license-limit-type.ts`); this list goes once licensing-contract depends on it.
 */
export const limitTypes = ["members", "membersLite"] as const;

export type LimitType = (typeof limitTypes)[number];
