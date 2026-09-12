/**
 * One explicit sample choice for the whole governance module.
 * Defaults to the organization's own data, including empty and loading states.
 * Pages replace their displayed datasets while samples are enabled.
 *
 * Ported from `platform/app/src/components/governance/sample/sampleMode.ts`.
 * Not itself in the manifest's port list, but every screen that renders
 * `SampleDataToggle`/`SampleDataBanner` (`./sample-data-controls.tsx`) needs
 * this hook to make them do anything, so it travels with them.
 */
import { useCallback, useSyncExternalStore } from "react";

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
  /** Whether `active` came from the reader rather than the default. */
  explicit: boolean;
  /** Turn the sample panels on, and remember that the reader asked. */
  show: () => void;
  /** Turn them off, and remember that too. */
  hide: () => void;
  /** `show`/`hide` against whatever is on screen — what the toggle calls. */
  toggle: () => void;
}

/** The shared choice, independent of each page's reads. */
export function useSampleMode(): SampleMode {
  const optIn = useSyncExternalStore(subscribeToSampleChoice, readSampleChoice, serverSampleChoice);
  const active = optIn ?? false;

  const show = useCallback(() => writeSampleChoice(true), []);
  const hide = useCallback(() => writeSampleChoice(false), []);
  const toggle = useCallback(() => writeSampleChoice(!active), [active]);

  return { active, explicit: optIn !== null, show, hide, toggle };
}
