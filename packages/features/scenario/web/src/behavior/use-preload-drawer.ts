/**
 * Fetch a drawer's code while the reader is still reading the list.
 *
 * `~/hooks/usePreloadDrawer` warmed a lazy chunk off the application's drawer
 * registry, which is `@langwatch/ui-drawer`'s now and INSTALLED by the
 * composing application — a feature package cannot see the composed registry,
 * so it cannot ask it for a chunk. The call sites are an optimisation and
 * nothing about the page depends on the fetch having happened, so the name
 * survives and does nothing until the application hands this family a
 * preloader of its own.
 *
 * RECORDED AS A LOSS rather than hidden: a row click on the scenario library
 * opens the editor a beat later than it used to, on a cold chunk.
 */

export function usePreloadDrawer(..._drawers: string[]): void {
  // Intentionally inert. See the module docblock.
}
