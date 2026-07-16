/**
 * Whimsical status verbs for Langy's "thinking" indicator.
 *
 * These render standalone (`${verb}…`), so they get to be short, daft and
 * grin-worthy. The first entry is deliberately calm (it's also what
 * reduced-motion users see, frozen), then it gets weirder as it cycles.
 *
 * ── ONE HARD RULE: A VERB MAY NOT CLAIM WORK ───────────────────────────────
 *
 * Every verb here is shown while the model is genuinely generating, so it must
 * be a joke about Langy's CHARACTER, never a statement about what it is DOING.
 * "Bribing the GPUs" is a joke. "Reading the whole file" is a false statement —
 * and it was one we told for ninety-seven seconds, on a turn whose worker never
 * spawned, while nothing whatsoever was being read.
 *
 * That is why the following are GONE:
 *   "Writing a TODO list", "Calling one more tool", "Reading the whole file"
 *   "Chasing a span", "Untangling a trace", "Tailing the spans",
 *   "Counting the tokens", "Evaluating the eval"
 * Each names a specific act. Shown at the wrong moment — which is most moments,
 * because they were cycled on a timer — each is a lie, and together they made a
 * dead turn read as a healthy one.
 *
 * What Langy is ACTUALLY doing, when it is doing anything, is on the tool stream
 * and is said truthfully by `logic/langyThinkingLine.ts`. This list is only ever
 * reached when the model is thinking and there is nothing specific to report.
 */

const PLAIN = ["Thinking", "Pondering", "Cooking", "Brewing", "Percolating"];

const ENGLISH_ABSURD = [
  "Reticulating splines",
  "Consulting the vibes",
  "Warming up the neurons",
  "Rummaging in the context window",
  "Herding stochastic parrots",
  "Doing the thinky thing",
  "Rolling for initiative",
  "Bribing the GPUs",
];

const DUTCH = [
  "Stroopwafeling",
  "Fietsing to the answer", // fiets = bike; the national verb
  "Being gezellig about it", // gezellig = the untranslatable cosy one
  "Checking buienradar", // the rain-radar app every Dutchie lives by
  "Blaming the NS", // the railways are, reliably, late
  "Just being direct", // Dutch bluntness, applied to your bug
  "Adding hagelslag", // chocolate sprinkles, on everything
  "Going Dutch on the tokens",
];

// Jokes about the model's CHARACTER. None claims an act.
const CLAUDE = [
  "Being absolutely right",
  "Adding an em-dash",
  "Over-apologising",
  "Ultra-thinking",
  "Resisting emojis",
  "Hedging slightly",
];

// Brand whimsy. "Chasing a span" / "Untangling a trace" / "Tailing the spans" /
// "Counting the tokens" / "Evaluating the eval" were cut: each names a real act
// Langy performs, so each is a claim — and a false one whenever it wasn't.
const LANGY_BRAND = [
  "Watching the langs", // Lang-Watch, geddit
  "Observing observably",
  "Sparkling",
];

export const LANGY_THINKING_VERBS = [
  ...PLAIN,
  ...ENGLISH_ABSURD,
  ...DUTCH,
  ...CLAUDE,
  ...LANGY_BRAND,
];
