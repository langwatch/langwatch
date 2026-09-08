/**
 * Whether the governance section is currently showing its sample panels.
 *
 * Lifted out of the Costs page so every governance screen answers the question
 * the same way. The rule is the trace explorer's (`usePreviewTracesActive`):
 * sample data fills an empty screen, gets out of the way once the screen has
 * something real on it, and an explicit choice by the reader beats both.
 *
 * "Off" means the sample panels are removed, not emptied. They illustrate
 * measurements the platform does not take yet, so there is nothing to swap in
 * for them — a permanently blank panel would imply we looked and found nothing.
 *
 * The choice is ONE choice for the whole section, not one per page. A reader
 * who turns the samples off is telling us they want to see their own screens,
 * and having to say it again on each of the six pages — then again on the way
 * back — reads as the product not listening. The page-specific half — how a
 * page's own reads become a `RealDataState` — stays with the page, so an
 * organization with real spend and no registered agents still meets figures on
 * Costs and samples on Agents. Only the reader's own answer is shared.
 *
 * Spec: specs/ai-governance/dashboard/governance-ui-controls.feature
 */
import { useCallback, useRef, useSyncExternalStore } from "react";

/**
 * What the real reads have told us so far. `unknown` is a distinct answer
 * rather than a pessimistic `absent`, because defaulting to sample-on while a
 * read is still in flight would flash the sample panels up and then pull them
 * away the moment the data landed.
 */
export type RealDataState = "unknown" | "present" | "absent";

/**
 * Resolve the three states from a page's real reads. A read that has not
 * answered is `null`; one that answered with no rows is an empty array.
 *
 * Any read holding a row means the page has something to show, so samples stay
 * out of the way. Only once *every* read has answered, and all of them are
 * empty, is the screen known to be empty — a single unanswered read is enough
 * to keep the answer `unknown`, since it might be the one holding the data.
 */
export function resolveRealDataState(
  reads: ReadonlyArray<{ length: number } | null>,
): RealDataState {
  if (reads.some((read) => read !== null && read.length > 0)) return "present";
  if (reads.some((read) => read === null)) return "unknown";
  return "absent";
}

/**
 * Hold the last real answer across a gap in the reads.
 *
 * Changing a filter chip re-keys every query, and until the new window lands
 * they all read as unanswered again. Recomputing the default from that gap
 * would take a page we already know is empty, decide we no longer know, and
 * pull the sample panels off the screen until the new reads arrive — a flicker
 * on every filter change. An answer we have already had stands until a later
 * one replaces it.
 */
export function settleRealDataState(
  previous: RealDataState,
  current: RealDataState,
): RealDataState {
  return current === "unknown" ? previous : current;
}

/**
 * `settleRealDataState` applied across renders. Writing the ref during render
 * is safe because the result depends only on the arguments, so a repeated
 * render reaches the same answer.
 */
export function useSettledRealDataState(
  reads: ReadonlyArray<{ length: number } | null>,
): RealDataState {
  const settled = useRef<RealDataState>("unknown");
  settled.current = settleRealDataState(
    settled.current,
    resolveRealDataState(reads),
  );
  return settled.current;
}

/**
 * Whether the sample panels render.
 *
 * `optIn` is the reader's own choice — `null` until they touch the toggle,
 * which is what lets the default follow the data underneath them. Once they
 * have chosen, the data no longer overrides it: a reader who turned samples
 * off does not want them back when a read comes back empty.
 */
export function sampleModeActive({
  optIn,
  realData,
}: {
  optIn: boolean | null;
  realData: RealDataState;
}): boolean {
  if (optIn !== null) return optIn;
  return realData === "absent";
}

// ---- The one shared choice ----------------------------------------------

/**
 * Where the section's single answer is kept.
 *
 * Session storage, not local: opting in is a decision about this sitting, not
 * a preference that follows you back tomorrow — the same line the trace
 * explorer draws for its sample traces.
 *
 * One key, no page suffix. The suffix is what used to make each page ask
 * again.
 */
export const SAMPLE_CHOICE_KEY = "governance.sample";

/**
 * The answer when the browser will not keep one. A browser with site data
 * blocked throws on the accessor itself, and a sample toggle is not worth
 * taking a page down for — so the choice lives in the tab's memory instead and
 * is simply forgotten on reload.
 */
let fallbackOptIn: boolean | null = null;

/** Everything currently rendering a sample affordance. */
const listeners = new Set<() => void>();

/**
 * Read the choice back, or `null` when the reader has not made one.
 *
 * Read through to storage on every call rather than cached, so that the answer
 * has exactly one home. It returns a primitive, which is what
 * `useSyncExternalStore` needs to compare cheaply.
 */
export function readSampleChoice(): boolean | null {
  try {
    const raw = window.sessionStorage.getItem(SAMPLE_CHOICE_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return null;
  } catch {
    return fallbackOptIn;
  }
}

/**
 * The write half, equally unable to throw, and the point at which every other
 * mounted toggle on the screen hears about it.
 */
export function writeSampleChoice(optIn: boolean | null): void {
  fallbackOptIn = optIn;
  try {
    if (optIn === null) window.sessionStorage.removeItem(SAMPLE_CHOICE_KEY);
    else window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, String(optIn));
  } catch {
    // A remembered toggle is a convenience; losing it is not worth an error.
  }
  for (const notify of [...listeners]) notify();
}

/**
 * Subscribe to the shared choice.
 *
 * Two toggles are on screen at once more often than it looks — a page header's
 * and a panel's own "see what this will look like" — and one moving while the
 * other stays put is the bug this exists to prevent. Navigation between
 * governance pages remounts everything, so storage carries the choice there;
 * this carries it between whatever is mounted right now.
 */
export function subscribeToSampleChoice(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** No storage on the server, and no reader to have chosen. */
const serverSampleChoice = (): boolean | null => null;

/** What a governance page needs to render its sample affordances. */
export interface SampleMode {
  /** Whether the sample panels, banner and badges render right now. */
  active: boolean;
  /** Whether `active` came from the reader rather than from the data. */
  explicit: boolean;
  /** Turn the sample panels on, and remember that the reader asked. */
  show: () => void;
  /** Turn them off, and remember that too. */
  hide: () => void;
  /** `show`/`hide` against whatever is on screen — what the toggle calls. */
  toggle: () => void;
}

/**
 * The section's shared choice, applied to one page's data.
 *
 * Every governance page calls this with its own `realData` and gets the same
 * `optIn` back, so the toggle a reader presses on the overview is the toggle
 * they pressed on People.
 */
export function useSampleMode({
  realData,
}: {
  realData: RealDataState;
}): SampleMode {
  const optIn = useSyncExternalStore(
    subscribeToSampleChoice,
    readSampleChoice,
    serverSampleChoice,
  );
  const active = sampleModeActive({ optIn, realData });

  const show = useCallback(() => writeSampleChoice(true), []);
  const hide = useCallback(() => writeSampleChoice(false), []);
  const toggle = useCallback(() => writeSampleChoice(!active), [active]);

  return { active, explicit: optIn !== null, show, hide, toggle };
}
