/**
 * Whimsical status verbs for Langy's "thinking" indicator.
 *
 * Unlike the shared DEFAULT_THINKING_VERBS — which get a user prompt appended
 * in the traces AI box and so must stay transitive — these render standalone
 * (`${verb}…`), so they get to be short and dry. Four flavours: plain, English
 * absurd, Dutch in-jokes, and how-Claude-does-it. The first entry is
 * deliberately calm (it's also what reduced-motion users see, frozen), then it
 * gets weirder as it cycles.
 *
 * Taste bar: dry beats cutesy. No brand puns, no self-congratulation — the
 * on-the-nose "watching the langs / sparkling" register reads as try-hard.
 */

const PLAIN = ["Thinking", "Pondering", "Cooking", "Brewing", "Percolating"];

const ENGLISH_ABSURD = [
  "Reticulating splines",
  "Consulting the vibes",
  "Warming up the neurons",
  "Rummaging in the context window",
  "Herding stochastic parrots",
  "Rolling for initiative",
  "Bribing the GPUs",
];

const DUTCH = [
  "Fietsing to the answer", // fiets = bike; the national verb
  "Being gezellig about it", // gezellig = the untranslatable cosy one
  "Checking buienradar", // the rain-radar app every Dutchie lives by
  "Blaming the NS", // the railways are, reliably, late
  "Just being direct", // Dutch bluntness, applied to your bug
  "Adding hagelslag", // chocolate sprinkles, on everything
];

const CLAUDE = [
  "Adding an em-dash",
  "Writing a TODO list",
  "Calling one more tool",
  "Reading the whole file",
  "Over-apologising",
  "Ultra-thinking",
  "Resisting emojis",
];

export const LANGY_THINKING_VERBS = [
  ...PLAIN,
  ...ENGLISH_ABSURD,
  ...DUTCH,
  ...CLAUDE,
];
