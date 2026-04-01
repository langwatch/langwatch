export const VALID_TAGS = ["production", "staging"] as const;
export type ValidTag = (typeof VALID_TAGS)[number];
