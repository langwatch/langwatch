export const SEEDED_TAGS = ["production", "staging"] as const;
export type SeededTag = (typeof SEEDED_TAGS)[number];
