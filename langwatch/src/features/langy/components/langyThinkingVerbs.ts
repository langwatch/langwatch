/**
 * Whimsical status verbs for Langy's "thinking" indicator.
 *
 * Unlike the shared DEFAULT_THINKING_VERBS — which get a user prompt appended
 * in the traces AI box and so must stay transitive — these render standalone
 * (`${verb}…`), so they get to be short, daft and grin-worthy. Five flavours:
 * plain, English absurd, Dutch in-jokes, "how Claude does it", and
 * Langy-as-a-brand. The first entry is deliberately calm (it's also what
 * reduced-motion users see, frozen), then it gets weirder as it cycles.
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

const CLAUDE = [
  "Being absolutely right",
  "Adding an em-dash",
  "Writing a TODO list",
  "Calling one more tool",
  "Reading the whole file",
  "Over-apologising",
  "Ultra-thinking",
  "Resisting emojis",
];

const LANGY_BRAND = [
  "Watching the langs", // Lang-Watch, geddit
  "Chasing a span",
  "Untangling a trace",
  "Tailing the spans",
  "Evaluating the eval",
  "Counting the tokens",
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
