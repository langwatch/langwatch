import { create } from "zustand";
import type { OrGroup } from "~/server/app-layer/traces/query-language/queries";

/**
 * Tracks which facet — or which OR group — the user is currently
 * hovering, so the search bar's chips and the sidebar's rows can
 * cross-highlight each other. A single global store keeps the wiring
 * trivial: every chip/row reports hover events here and a single style
 * renderer (mounted in the sidebar) reads back to inject targeted CSS
 * outlines.
 *
 * `hoveredGroup` wins when set. Otherwise `hoveredFacet` carries the
 * single-row case (active filter that isn't part of any OR group); the
 * highlighter still draws across the chip ↔ row pair so users see the
 * link.
 */
interface HoverState {
  hoveredGroup: OrGroup | null;
  hoveredFacet: { field: string; value: string } | null;
  setHoveredGroup: (group: OrGroup | null) => void;
  setHoveredFacet: (facet: { field: string; value: string } | null) => void;
  clearHover: () => void;
}

export const useFacetHoverStore = create<HoverState>((set) => ({
  hoveredGroup: null,
  hoveredFacet: null,
  setHoveredGroup: (group) =>
    set({ hoveredGroup: group, hoveredFacet: null }),
  setHoveredFacet: (facet) =>
    set({ hoveredFacet: facet, hoveredGroup: null }),
  clearHover: () => set({ hoveredGroup: null, hoveredFacet: null }),
}));
