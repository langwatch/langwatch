import { create } from "zustand";

/**
 * What the TIME / SINCE column shows in the trace table:
 *   - `relative` — "4m" / "4 minutes ago" (the current default for both columns)
 *   - `absolute` — "Jun 4 18:32" (wall-clock timestamp)
 *
 * Owned by a tiny store rather than props/uiStore because every time
 * cell subscribes — colocating it with the rest of the trace UI prefs
 * keeps the cells from re-rendering on unrelated UI state changes.
 * Persisted to localStorage so the operator's choice survives reloads.
 */
export type TimeColumnMode = "relative" | "absolute";

interface TimeColumnModeState {
  mode: TimeColumnMode;
  setMode: (mode: TimeColumnMode) => void;
}

const STORAGE_KEY = "langwatch:traces-v2:timeColumnMode";

function loadMode(): TimeColumnMode {
  if (typeof window === "undefined") return "relative";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "absolute" || stored === "relative") return stored;
  } catch {
    // ignore
  }
  return "relative";
}

function persistMode(mode: TimeColumnMode): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // storage may be full / disabled
  }
}

export const useTimeColumnModeStore = create<TimeColumnModeState>((set) => ({
  mode: loadMode(),
  setMode: (mode) => {
    set({ mode });
    persistMode(mode);
  },
}));
