import type { StageId } from "./onboardingJourneyConfig";

/**
 * Chapter is the user-facing grouping of the journey — six stops on
 * a narrative arc. Each chapter contains 1+ stages. The journey
 * itself runs on `StageId`s (the small machine), but consumers that
 * want to talk to the user about *progress* (BeadStrip, returning-
 * user hub) should think in chapters.
 *
 * Arc per the §14 design discussion (drawer-as-finale):
 *
 *   welcome → density → slice → arrivals → drawer → outro
 *
 * Cosmetic → structural → temporal → diagnostic → close. Reads like
 * a sentence: greet, match prefs, teach filtering, watch data land,
 * dig into one trace, wrap up.
 */
export type ChapterId =
  | "welcome"
  | "density"
  | "slice"
  | "arrivals"
  | "drawer"
  | "outro";

export interface Chapter {
  id: ChapterId;
  /** Short label rendered in the BeadStrip / returning-user hub. */
  label: string;
  /**
   * One-line hint shown on hover (or when the BeadStrip dot is
   * focused). Captures the "what does this chapter teach" question
   * in plain language — same voice as the hero copy.
   */
  hint: string;
}

/**
 * The canonical chapter order. Index in this array doubles as the
 * "you are here" position for the BeadStrip. Order matches the
 * current stage order — see the file header for the planned
 * reorder.
 */
export const CHAPTERS: Chapter[] = [
  { id: "welcome", label: "Welcome", hint: "Meet the trace explorer." },
  { id: "density", label: "Density", hint: "Match your vibe." },
  {
    id: "slice",
    label: "Slice",
    hint: "Filter and group with lenses and facets.",
  },
  {
    id: "arrivals",
    label: "Arrivals",
    hint: "Watch new traces land in real time.",
  },
  { id: "drawer", label: "Drawer", hint: "See one trace in detail." },
  { id: "outro", label: "Done", hint: "All yours." },
];

/**
 * Maps every stage to the chapter that contains it. Stages within
 * a chapter share the same dot in the BeadStrip — sub-beats inside
 * a chapter (e.g. `welcome` → `trace_explorer`) don't move the dot.
 */
export const STAGE_TO_CHAPTER: Record<StageId, ChapterId> = {
  settle: "welcome",
  welcome: "welcome",
  trace_explorer: "welcome",
  densityIntro: "density",
  serviceSegue: "slice",
  facetsReveal: "slice",
  arrivalPrep: "arrivals",
  auroraArrival: "arrivals",
  postArrival: "arrivals",
  drawerOverview: "drawer",
  outro: "outro",
  complete: "outro",
};

export function chapterOf(stage: StageId): ChapterId {
  return STAGE_TO_CHAPTER[stage];
}

export function chapterIndex(stage: StageId): number {
  const chId = chapterOf(stage);
  const idx = CHAPTERS.findIndex((c) => c.id === chId);
  return idx === -1 ? 0 : idx;
}
