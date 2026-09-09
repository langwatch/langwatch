/**
 * The empty-state onboarding journey, as one editable config.
 */
export type StageId =
  | "settle"
  | "welcome"
  | "trace_explorer"
  | "densityIntro"
  | "serviceSegue"
  | "facetsReveal"
  | "arrivalPrep"
  | "auroraArrival"
  | "auroraLanding"
  | "postArrival"
  | "drawerOverview"
  | "outro"
  | "complete";

/**
 * Where the hero composition sits on the page during a stage. - `centre` — default.
 */
export type HeroLayout = "centre" | "left" | "bottomCentre" | "topBanner";

export interface StageDef {
  id: StageId;
  /**
   * Top-line copy. Lighter weight, large display type in the hero. Optional — stages
   * can hide the hero entirely (e.g. the aurora-arrival beat is purely visual, the
   * aurora itself does the talking, no copy on screen).
   */
  heading?: string;
  /** Optional secondary copy. Reads as muted, line below the heading. */
  subhead?: string;
  /**
   * If set, the stage auto-advances to `next` after this many ms. Use for narrative
   * beats where we don't need user input.
   */
  holdMs?: number;
  /**
   * If set, render an inline button with this label that advances to `next` when
   * clicked. Use for stages that wait for the user to explicitly say "ok, next." Pairs
   * with `typewriter` to act as a "skip ahead" while the text is still typing.
   */
  cta?: string;
  /** Stage to transition to via auto-advance or CTA click. */
  next?: StageId;
  /** Render the aurora strip during this stage. */
  showAurora?: boolean;
  /**
   * Merge the held-back `ARRIVAL_PREVIEW_TRACES` into the preview
   * set during this stage and any later one that also sets it.
   */
  showArrivals?: boolean;
  /**
   * Highlight the rich arrival trace as the directional click
   * target for this stage. (Future: row gets a darker-blue
   * background and a bouncing indicator.)
   */
  highlightRichRow?: boolean;
  /**
   * Render heading + subhead with a per-char typewriter effect
   * instead of a fade-in. Stage auto-advances ~1.5s after both
   * lines finish typing. The CTA acts as a skip-ahead.
   */
  typewriter?: boolean;
  /**
   * Show the side-by-side density-choice cards. Currently only
   * `densityIntro` uses this, but kept as a flag so the spotlight
   * could appear elsewhere later if we want.
   */
  showDensitySpotlight?: boolean;
  /**
   * Show the always-on `Integrate my code` CTA during this stage. Defaults to `true`.
   * We hide it during welcome + densityIntro so the user isn't reading copy / picking
   * density next to a blinking primary action.
   */
  showIntegrateCta?: boolean;
  /** Where the hero composition sits during this stage. */
  heroLayout?: HeroLayout;
  /**
   * Dim the hero text during this stage so the user's attention is drawn away from the
   * copy and toward the visual moment (currently used during `auroraArrival` so the
   * aurora steals the spotlight).
   */
  dimHero?: boolean;
}

export const INITIAL_STAGE: StageId = "settle";

export const ONBOARDING_JOURNEY: StageDef[] = [
  {
    id: "settle",
    // No copy on screen during settle — this stage just gives the table + mesh
    // background a beat to render before we drop the mask + welcome typewriter on top.
    holdMs: 1400,
    next: "welcome",
    showIntegrateCta: false,
  },
  {
    id: "welcome",
    heading: "Welcome.",
    // First beat of the two-beat welcome. Just "Welcome." typed out
    // and held. Lets the user *read* the page before we start
    // narrating it. No subhead — anything more turns this into a
    // reading task before the tour begins.
    typewriter: true,
    holdMs: 1300,
    next: "trace_explorer",
    showIntegrateCta: false,
  },
  {
    id: "trace_explorer",
    heading: "Meet your trace explorer.",
    // Second beat — the actual product introduction. Subhead is
    // kept short so the auto-advance pause feels natural rather
    // than "we're holding you hostage waiting to read." A longer
    // linger gives the user time to register both lines before
    // density kicks in.
    subhead: "Same data, fresh layout. We'll have you in in a minute.",
    typewriter: true,
    holdMs: 1700,
    next: "densityIntro",
    showIntegrateCta: false,
  },
  {
    id: "densityIntro",
    heading: "Let's match your vibe.",
    subhead: "Pick a density. Swap any time from the toolbar, or press D.",
    cta: "Continue",
    next: "serviceSegue",
    showDensitySpotlight: true,
    showIntegrateCta: false,
  },
  {
    // ---- SLICE chapter (renamed from the old "filter the table" detour). Slice now
    // comes BEFORE arrivals so the user understands "I can filter this" before data
    // lands. Drawer is the climax (after arrivals), not a navigation gate.
    id: "serviceSegue",
    heading: "Two ways to cut through.",
    subhead: "Lens tabs above reshape the whole table. Facets in the sidebar narrow what you see.",
    typewriter: true,
    cta: "Show me",
    next: "facetsReveal",
    showIntegrateCta: false,
    heroLayout: "centre",
  },
  {
    id: "facetsReveal",
    heading: "Pick a facet, narrow the view.",
    subhead:
      "Same tags you'll find inside a trace — applied to the whole table. Or type a query in the bar up top.",
    typewriter: true,
    cta: "Got it",
    next: "arrivalPrep",
    showIntegrateCta: false,
    heroLayout: "centre",
  },
  {
    // ---- ARRIVALS chapter (aurora + click-the-row). Comes after
    // slice, so when the rows arrive the user already knows they
    // can filter them. Click-the-row leads directly into the
    // drawer chapter — no tour gate.
    id: "arrivalPrep",
    heading: "Watch out for the aurora...\nNew traces tend to follow it.",
    typewriter: true,
    // Bumped back up — the previous 600ms made the aurora warning feel like a "blink
    // and you missed it" beat.
    holdMs: 2200,
    next: "auroraArrival",
    showIntegrateCta: false,
  },
  {
    id: "auroraArrival",
    // Heading carries through from arrivalPrep so the screen doesn't go blank while the
    // aurora actually plays — that read like a skipped stage.
    heading: "Watch out for the aurora...\nNew traces tend to follow it.",
    holdMs: 1800,
    next: "auroraLanding",
    showAurora: true,
    showArrivals: false,
    showIntegrateCta: false,
    dimHero: true,
  },
  {
    id: "auroraLanding",
    // Second beat of the marquee moment: ribbon stays visible while the new arrivals slide in underneath it, so
    // the user reads "the aurora is what brought these in." Total time on the ribbon (auroraArrival +
    // auroraLanding) lands ~5.8s, matching what the previous single stage held.
    heading: "Watch out for the aurora...\nNew traces tend to follow it.",
    holdMs: 4000,
    next: "postArrival",
    showAurora: true,
    showArrivals: true,
    showIntegrateCta: false,
    dimHero: true,
  },
  {
    id: "postArrival",
    // Direct + neutral — points at the row without telegraphing the content of the
    // trace. The juicy bit is what's *inside* the drawer; this just opens the door.
    heading: "There's a juicy one.",
    subhead: "Click the highlighted row to see how the agent worked through it.",
    typewriter: true,
    showArrivals: true,
    highlightRichRow: true,
  },
  {
    // ---- DRAWER chapter — the climax. The trace drawer opens via
    // the postArrival row click; this stage anchors the hero to the
    // left so it doesn't get clipped by the drawer, and walks the
    // user through what's inside.
    id: "drawerOverview",
    heading: "And here's the substance.",
    // The drawer is the densest information surface in the product.
    // "Take your time" frames lingering as the default; Continue
    // sits there for users who want to press on.
    subhead: "Conversation, spans, evals — it's all in here. Take your time, then we'll wrap up.",
    typewriter: true,
    cta: "Wrap up",
    next: "outro",
    showArrivals: true,
    showIntegrateCta: false,
    heroLayout: "left",
  },
  {
    id: "outro",
    // Terminal chapter — renders as a thin top banner instead of a centred hero
    // overlay.
    showArrivals: true,
    heroLayout: "topBanner",
    showIntegrateCta: false,
  },
  {
    id: "complete",
    heading: "All yours.",
    subhead: "Explore the table, or integrate your code to send your own.",
    showArrivals: true,
  },
];

export function findStageDef(id: StageId): StageDef {
  const def = ONBOARDING_JOURNEY.find((s) => s.id === id);
  if (def) return def;
  // Defensive fallback — a stage id from an older shape of the journey can still be
  // sitting in the (in-memory) zustand store after HMR or a code change that drops a
  // stage.
  // eslint-disable-next-line no-console
  console.warn(`[onboarding] Unknown stage "${id}", falling back to "${INITIAL_STAGE}"`);
  return ONBOARDING_JOURNEY[0]!;
}

/** Convenience predicate for the trace-list query. */
export function shouldShowArrivals(id: StageId): boolean {
  return findStageDef(id).showArrivals ?? false;
}

/** Convenience predicate for the aurora strip in `TracesPage`. */
export function shouldShowAurora(id: StageId): boolean {
  return findStageDef(id).showAurora ?? false;
}
