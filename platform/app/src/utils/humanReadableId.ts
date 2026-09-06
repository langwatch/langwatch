/**
 * Human-readable ID generator
 *
 * Generates memorable, human-readable identifiers using adjective-adjective-noun combinations.
 * Similar to Docker container names, Heroku app names, etc.
 * Uses 3 words for sufficient uniqueness without confusing numeric suffixes.
 */

const ADJECTIVES = [
  "swift",
  "bright",
  "calm",
  "eager",
  "bold",
  "keen",
  "warm",
  "cool",
  "wise",
  "fair",
  "glad",
  "kind",
  "neat",
  "pure",
  "safe",
  "true",
  "vast",
  "wild",
  "zesty",
  "agile",
  "brave",
  "crisp",
  "dense",
  "epic",
  "fresh",
  "grand",
  "happy",
  "ideal",
  "jolly",
  "lively",
  "merry",
  "noble",
  "proud",
  "quick",
  "rapid",
  "sharp",
  "smart",
  "solid",
  "sunny",
  "vivid",
  "gentle",
  "silent",
  "cosmic",
  "golden",
  "silver",
  "ancient",
  "modern",
  "mighty",
  "humble",
];

const NOUNS = [
  "fox",
  "owl",
  "bee",
  "elk",
  "hawk",
  "lynx",
  "wolf",
  "bear",
  "deer",
  "dove",
  "eagle",
  "finch",
  "heron",
  "koala",
  "lemur",
  "moose",
  "otter",
  "panda",
  "raven",
  "robin",
  "seal",
  "swan",
  "tiger",
  "whale",
  "zebra",
  "atlas",
  "bloom",
  "cloud",
  "delta",
  "ember",
  "flame",
  "grove",
  "haven",
  "iris",
  "jade",
  "leaf",
  "moon",
  "nova",
  "ocean",
  "peak",
  "river",
  "spark",
  "storm",
  "tide",
  "wave",
  "comet",
  "prism",
  "coral",
];

/**
 * Generate a human-readable ID with 3 words like "swift-bright-fox" or "calm-eager-owl"
 * Uses adjective-adjective-noun pattern for ~125,000 combinations.
 */
export const generateHumanReadableId = (options?: {
  /** Separator between words (default: "-") */
  separator?: string;
}): string => {
  const { separator = "-" } = options ?? {};

  // Pick two different adjectives
  const adj1Index = Math.floor(Math.random() * ADJECTIVES.length);
  let adj2Index = Math.floor(Math.random() * ADJECTIVES.length);
  // Ensure we don't pick the same adjective twice
  if (adj2Index === adj1Index) {
    adj2Index = (adj2Index + 1) % ADJECTIVES.length;
  }

  const adjective1 = ADJECTIVES[adj1Index]!;
  const adjective2 = ADJECTIVES[adj2Index]!;
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]!;

  return `${adjective1}${separator}${adjective2}${separator}${noun}`;
};
