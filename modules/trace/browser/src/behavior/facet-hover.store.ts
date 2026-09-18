import { create } from "zustand";

/**
 * Tracks which facet the user is currently hovering, so the search bar's chips and the
 * sidebar's rows can cross-highlight each other.
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
