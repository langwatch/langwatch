import { create } from "zustand";

/**
 * Closed set of section ids that header chips and comment anchors can deep-link into.
 */
const FOCUS_SECTIONS = [
  "attributes",
  "evals",
  "events",
  "exceptions",
  "io",
  "logs",
  "other",
  "prompt",
  "prompts",
  "scope",
] as const;
export type FocusSection = (typeof FOCUS_SECTIONS)[number];

/** Whether a section id is one this build can focus. */
export function isFocusSection(value: string): value is FocusSection {
  return FOCUS_SECTIONS.some((section) => section === value);
}

interface PendingFocus {
  /** Trace this focus request applies to — observers ignore other traces. */
  traceId: string;
  /** Section id to expand + scroll to (matches the `value` of a `<Section>`). */
  section: FocusSection;
  /**
   * Monotonic counter so re-clicking the same chip re-triggers the effect
   * even when traceId + section are identical to the prior request.
   */
  nonce: number;
}

interface FocusSectionState {
  pending: PendingFocus | null;
  request: (params: { traceId: string; section: FocusSection }) => void;
  clear: () => void;
}

/**
 * One-shot signal store for "expand + scroll the trace summary section with id X".
 */
export const useFocusSectionStore = create<FocusSectionState>((set, get) => ({
  pending: null,
  request: ({ traceId, section }) => {
    const nonce = (get().pending?.nonce ?? 0) + 1;
    set({ pending: { traceId, section, nonce } });
  },
  clear: () => set({ pending: null }),
}));
