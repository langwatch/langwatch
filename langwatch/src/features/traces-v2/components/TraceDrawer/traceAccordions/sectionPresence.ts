import { useEffect, useRef, useState } from "react";
import { create } from "zustand";

/**
 * Tracks accordion open-state with auto-expand:
 * - On identity change (new trace / new span), reset to all sections that
 *   currently have content.
 * - On content arriving asynchronously within the same identity, open the
 *   newly-populated section (without re-opening sections the user closed).
 * - User toggles inside an identity are preserved.
 */
export function useAutoOpenSections(
  identity: string,
  content: Record<string, boolean>,
): [string[], (next: string[]) => void] {
  const [open, setOpen] = useState<string[]>(() =>
    Object.entries(content)
      .filter(([, has]) => has)
      .map(([k]) => k),
  );
  const lastIdentityRef = useRef(identity);
  const prevContentRef = useRef(content);

  // Stable serialization for the effect dep.
  const contentKey = Object.entries(content)
    .map(([k, v]) => `${k}=${v ? 1 : 0}`)
    .sort()
    .join("|");

  useEffect(() => {
    if (lastIdentityRef.current !== identity) {
      lastIdentityRef.current = identity;
      prevContentRef.current = content;
      setOpen(
        Object.entries(content)
          .filter(([, has]) => has)
          .map(([k]) => k),
      );
      return;
    }
    // Same identity — auto-open sections that just gained content.
    setOpen((prev) => {
      const set = new Set(prev);
      let changed = false;
      for (const [key, hasContent] of Object.entries(content)) {
        if (hasContent && !prevContentRef.current[key] && !set.has(key)) {
          set.add(key);
          changed = true;
        }
      }
      prevContentRef.current = content;
      return changed ? Array.from(set) : prev;
    });
    // identity + contentKey are sufficient — content object is recreated each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, contentKey]);

  return [open, setOpen];
}

export interface SectionPresenceState {
  traceId: string | null;
  tab: "summary" | "span" | null;
  set: (next: { traceId: string; tab: "summary" | "span" }) => void;
  clear: () => void;
}

/**
 * Holds which trace + tab is currently rendered in the accordion shell so
 * deeply-nested `Section` components can broadcast presence without
 * prop-drilling and without React Context (banned by traces-v2 STANDARDS §2).
 * Only one drawer mounts at a time.
 */
export const useSectionPresenceStore = create<SectionPresenceState>((set) => ({
  traceId: null,
  tab: null,
  set: ({ traceId, tab }) => set({ traceId, tab }),
  clear: () => set({ traceId: null, tab: null }),
}));

export function useSyncSectionPresence(value: {
  traceId: string;
  tab: "summary" | "span";
}): void {
  const setPresence = useSectionPresenceStore((s) => s.set);
  const clearPresence = useSectionPresenceStore((s) => s.clear);
  useEffect(() => {
    setPresence(value);
    return () => clearPresence();
  }, [value.traceId, value.tab, setPresence, clearPresence]);
}
