/**
 * The empty-state onboarding journey, as one editable config.
 *
 * Tweak copy, timings, and stage order *here* — every consumer
 * (`TracesEmptyOnboarding`, `TracesPage`, `useTraceListQuery`) reads
 * from this single source so changes show up without component-code
 * edits.
 *
 * Stage flow:
 *
 *   welcome1     →  welcome2     →  densityIntro  →  auroraArrival  →  postArrival  →  complete
 *   (auto 3.5s)     (auto 4.5s)     (manual CTA)     (auto 4s)         (row click)
 *
 * `holdMs + next` ⇒ auto-advance after the delay.
 * `cta + next`    ⇒ render an inline CTA button that advances on click.
 * Both omitted    ⇒ terminal until an external event (row click,
 *                   dismiss) advances or unmounts the journey.
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
  | "postArrival"
  | "drawerOverview"
  | "outro"
  | "complete";

/**
 * Where the hero composition sits on the page during a stage.
 *  - `centre`       — default. Flex-centred over the (cut-out) table.
 *  - `left`         — narrow column anchored to the left, used while
 *                     the trace drawer is open on the right.
 *  - `bottomCentre` — bottom-anchored, centred horizontally, used
 *                     while the facet sidebar takes the left rail.
 */
export type HeroLayout = "centre" | "left" | "bottomCentre";

export interface StageDef {
  id: StageId;
  /**
   * Top-line copy. Lighter weight, large display type in the hero.
   * Optional — stages can hide the hero entirely (e.g. the
   * aurora-arrival beat is purely visual, the aurora itself does
   * the talking, no copy on screen).
   */
  heading?: string;
  /** Optional secondary copy. Reads as muted, line below the heading. */
  subhead?: string;
  /**
   * If set, the stage auto-advances to `next` after this many ms.
   * Use for narrative beats where we don't need user input.
   * Stages with `typewriter: true` should *not* set this — the
   * typewriter effect calls advance itself once the text finishes
   * typing + a small linger pause.
   */
  holdMs?: number;
  /**
   * If set, render an inline button with this label that advances
   * to `next` when clicked. Use for stages that wait for the user
   * to explicitly say "ok, next." Pairs with `typewriter` to act
   * as a "skip ahead" while the text is still typing.
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
   * Show the always-on `Integrate my code` CTA during this stage.
   * Defaults to `true`. We hide it during welcome + densityIntro
   * so the user isn't reading copy / picking density next to a
   * blinking primary action.
   */
  showIntegrateCta?: boolean;
  /** Where the hero composition sits during this stage. */
  heroLayout?: HeroLayout;
  /**
   * Dim the hero text during this stage so the user's attention
   * is drawn away from the copy and toward the visual moment
   * (currently used during `auroraArrival` so the aurora steals
   * the spotlight).
   */
  dimHero?: boolean;
}

export const INITIAL_STAGE: StageId = "settle";

export const ONBOARDING_JOURNEY: StageDef[] = [
  {
    id: "settle",
    // No copy on screen during settle — this stage just gives the
    // table + mesh background a beat to render before we drop the
    // mask + welcome typewriter on top. On a fresh refresh the
    // previous behaviour was "instantly show heading," which felt
    // grabby — like the page was trying to seize attention before
    // the user had taken in what they were looking at. 1.4s is
    // enough time for the spans to land and the eye to settle, not
    // long enough to read as "stuck loading."
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
    subhead: "Same data, fresh layout. Quick setup, then you're in.",
    typewriter: true,
    holdMs: 1700,
    next: "densityIntro",
    showIntegrateCta: false,
  },
  {
    id: "densityIntro",
    heading: "Firstly, let's match your vibe.",
    subhead: "Pick a density. Swap any time from the toolbar, or press D.",
    cta: "Continue",
    next: "serviceSegue",
    showDensitySpotlight: true,
    showIntegrateCta: false,
  },
  {
    // ---- SLICE chapter (renamed from the old "filter the table"
    // detour). Slice now comes BEFORE arrivals so the user
    // understands "I can filter this" before data lands. Drawer is
    // the climax (after arrivals), not a navigation gate. See
    // `chapters.ts` and the §14 design discussion for the arc
    // rationale.
    id: "serviceSegue",
    heading: "Lenses + facets.",
    subhead:
      "Lens tabs above shape the whole table. Facets in the sidebar slice it.",
    typewriter: true,
    cta: "Show me",
    next: "facetsReveal",
    showIntegrateCta: false,
    heroLayout: "centre",
  },
  {
    id: "facetsReveal",
    heading: "Click any facet to slice.",
    subhead:
      "Same chips you'll see inside a trace, lifted to the sidebar so they apply to the whole table. Filter bar up top takes a query if you'd rather type.",
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
    // Bumped back up — the previous 600ms made the aurora warning
    // feel like a "blink and you missed it" beat. The aurora itself
    // is the held frame, but the *warning* needs enough time on
    // screen for the user to read both lines and look up. ~2.2s
    // after the typewriter finishes is the sweet spot — long enough
    // that the eye reaches "aurora" before the ribbon plays, short
    // enough that it doesn't read as stalled.
    holdMs: 2200,
    next: "auroraArrival",
    showIntegrateCta: false,
  },
  {
    id: "auroraArrival",
    // Heading carries through from arrivalPrep so the screen
    // doesn't go blank while the aurora actually plays — that
    // read like a skipped stage. Heading is kept identical so the
    // hero motion key (based on heading text) doesn't remount and
    // we don't get a re-fade flicker. Hero text dims during the
    // aurora so the user's eye is pulled UP to the ribbon, then
    // fades back when we advance.
    heading: "Watch out for the aurora...\nNew traces tend to follow it.",
    // 5800ms — gives the aurora long enough to read as a *moment*
    // rather than a flash. The drift cycles are 8–13s so we still
    // won't see a full one, but stretching past the previous 4.8s
    // means the user has time to register the ribbon, see the rows
    // land underneath it, and feel that something arrived. This is
    // the journey's marquee visual; it earns the extra second.
    holdMs: 5800,
    next: "postArrival",
    showAurora: true,
    showArrivals: true,
    showIntegrateCta: false,
    dimHero: true,
  },
  {
    id: "postArrival",
    // Direct + neutral — points at the row without telegraphing the
    // content of the trace. The juicy bit is what's *inside* the
    // drawer; this just opens the door. Clicking the row advances
    // straight to drawerOverview — there's no tour gate any more,
    // because the drawer is now the finale of the journey rather
    // than an optional detour.
    heading: "There's a juicy one.",
    subhead:
      "Click the highlighted row to see how the agent worked through it.",
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
    subhead:
      "Conversation, spans, evals — it's all in here. Take your time, then we'll wrap up.",
    typewriter: true,
    cta: "Wrap up",
    next: "outro",
    showArrivals: true,
    showIntegrateCta: false,
    heroLayout: "left",
  },
  {
    id: "outro",
    // Terminal chapter — renders as the OutroPanel (highlight cards
    // + integrate / done CTAs) instead of a typewriter hero. The
    // panel absorbs the role the standalone "What's-new" dialog
    // used to play, so all the post-tour content (multiplayer,
    // shortcuts, integrate) lives in one place at the end of the
    // journey rather than as a separate dialog the user has to
    // re-open.
    showArrivals: true,
    heroLayout: "centre",
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
  // Defensive fallback — a stage id from an older shape of the
  // journey can still be sitting in the (in-memory) zustand store
  // after HMR or a code change that drops a stage. Rather than
  // crashing the whole pane, log once and fall back to the first
  // stage. The journey will resume from the start, which matches
  // what we'd want anyway.
  // eslint-disable-next-line no-console
  console.warn(
    `[onboarding] Unknown stage "${id}", falling back to "${INITIAL_STAGE}"`,
  );
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
