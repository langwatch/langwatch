export const VALID_LABELS = ["production", "staging"] as const;
export type ValidLabel = (typeof VALID_LABELS)[number];
