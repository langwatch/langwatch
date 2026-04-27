/**
 * Lens Analytics — invisible event logging for user interactions with lenses.
 * Stores events in localStorage with a 1000-event cap (FIFO).
 * No UI component — just a logging API consumed by store actions.
 */

type LensEventType =
  | "lens_created"
  | "lens_switched"
  | "lens_saved"
  | "lens_deleted"
  | "lens_renamed"
  | "lens_duplicated"
  | "lens_reverted"
  | "column_toggled"
  | "column_reordered"
  | "column_resized"
  | "grouping_changed"
  | "conditional_format_added"
  | "conditional_format_removed"
  | "draft_discarded";

interface LensAnalyticsEvent {
  timestamp: number;
  type: LensEventType;
  lensId?: string;
  columnId?: string;
  grouping?: string;
  detail?: string;
}

const MAX_EVENTS = 1000;

function getStorageKey(): string {
  return "langwatch:lensAnalytics";
}

function loadEvents(): LensAnalyticsEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(getStorageKey());
    if (stored) {
      return JSON.parse(stored) as LensAnalyticsEvent[];
    }
  } catch {
    // ignore
  }
  return [];
}

function persistEvents(events: LensAnalyticsEvent[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(events));
  } catch {
    // ignore — storage may be full
  }
}

/**
 * Log a lens analytics event. Appends to the buffer, evicting oldest events
 * when the cap is reached. Debounced events (resize) should be handled by callers.
 */
export function logLensEvent(event: Omit<LensAnalyticsEvent, "timestamp">) {
  const events = loadEvents();
  events.push({ ...event, timestamp: Date.now() });

  // FIFO: remove oldest events if over cap
  while (events.length > MAX_EVENTS) {
    events.shift();
  }

  persistEvents(events);
}

/**
 * Read all stored lens analytics events. For debugging and future server sync.
 */
export function getLensEvents(): LensAnalyticsEvent[] {
  return loadEvents();
}

/**
 * Clear all stored lens analytics events.
 */
export function clearLensEvents() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(getStorageKey());
  } catch {
    // ignore
  }
}
