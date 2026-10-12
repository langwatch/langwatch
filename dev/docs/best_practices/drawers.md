# Drawers

Render `<Drawer title onClose footer={{ ... }}>`; the shape draws header, body and footer
([ADR-002](../../../packages/design-system/adrs/002-overlay-and-card-shapes.md)). The raw parts
and the trace drawer keep their own material.

## Partly translucent header and footer

Ruled 2026-10-11: the body stays opaque and scrolls; the header band (header plus toolbar) and the
footer are the card material (`bg.card` at half strength, 12px blur) laid over it, so content passes
beneath. It is **on** by default (approved by Alex after the light and dark screenshots, 2026-10-11);
`DRAWER_GLASS_DEFAULT` in `overlays/drawer-chrome.rules.ts` turns it off. Stories `Overlays/Drawer` Solid and Glass, light and dark,
show the pair.

| Concern     | Behaviour                                                                                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout      | Header band and footer are absolute over the body, which is the one scrollport; its padding and scroll-padding follow their measured heights (`--lw-drawer-top`, `--lw-drawer-bottom`). |
| Edge        | A 1px edge plus a faint glint shows only where content waits past it: header once scrolled, footer until the end. Off when the content fits.                                            |
| Tokens      | `bg.drawer.chrome`, `border.drawer.edge`, `border.drawer.glint` in `config.ts`; callers never pick alpha, blur or colour.                                                               |
| Fallbacks   | `data-reduced-graphics` and `prefers-reduced-transparency` are opaque with no blur; reduced motion drops the edge fade; forced colours draw a static system edge.                       |
| Not covered | `bodyScroll="content"` hosts keep flex siblings and static separators until their pane gets a measured scroll port.                                                                     |

Code: `overlays/use-drawer-chrome.ts` (measuring, edge state), `drawer-chrome.rules.ts` (pure edge
rule), `overlays/drawer-chrome.tsx` (bands), `system/drawer.recipe.ts` (material).
