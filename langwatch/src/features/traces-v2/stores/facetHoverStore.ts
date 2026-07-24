import { create } from "zustand";

/**
 * Tracks which facet the user is currently hovering, so the search
 * bar's chips and the sidebar's rows can cross-highlight each other. A
 * single global store keeps the wiring trivial: every chip/row reports
 * hover events here and a single style renderer (mounted in the
 * sidebar) reads back to inject targeted CSS outlines.
 *
 * `hoveredFacet` carries the single (field, value) pair under the
 * cursor; the highlighter draws across the matching chip ↔ row pair so
 * users see the link.
 */
interface HoveredFacet {
  field: string;
  value: string;
  /** Chakra palette of the facet's dot (e.g. "teal", "purple") so the
   *  cross-highlight can paint in the facet's OWN colour instead of a
   *  hardcoded blue that overrides every facet's identity. Omitted when the
   *  hover originates from a search-bar chip, which doesn't know the palette —
   *  the highlighter falls back to a neutral emphasis there. */
  palette?: string;
}

interface HoverState {
  hoveredFacet: HoveredFacet | null;
  setHoveredFacet: (facet: HoveredFacet | null) => void;
  clearHover: () => void;
}

export const useFacetHoverStore = create<HoverState>((set) => ({
  hoveredFacet: null,
  setHoveredFacet: (facet) => set({ hoveredFacet: facet }),
  clearHover: () => set({ hoveredFacet: null }),
}));
