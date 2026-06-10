/**
 * Six well-spaced pastel hues used to colour OR groups across the
 * sidebar. The same palette + same hash function must drive the
 * connector line, the section pill, the row outline, and the
 * `HoverHighlightStyle` selector — otherwise an OR group's pieces
 * would render in different colours and the visual link breaks.
 *
 * Single source of truth — `FacetRow`, `SidebarSection`,
 * `OrConnectorOverlay`, and `HoverHighlightStyle` all import from
 * here.
 */
export const OR_GROUP_PALETTE = [
  "purple",
  "teal",
  "pink",
  "yellow",
  "cyan",
  "green",
] as const;

export type OrGroupPaletteColor = (typeof OR_GROUP_PALETTE)[number];

/**
 * Map a group's stable id (e.g. `or-12-43`) to a palette colour.
 * Uses a tiny djb2-ish hash so the same id always maps to the same
 * hue across components and re-renders.
 */
export function orGroupColor(id: string): OrGroupPaletteColor {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return OR_GROUP_PALETTE[
    Math.abs(h) % OR_GROUP_PALETTE.length
  ] as OrGroupPaletteColor;
}
