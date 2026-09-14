/**
 * Trigger a full-page navigation (not a client-side route change).
 *
 * Used when we need to bust an in-memory React Query cache or SWR cache that
 * the next page relies on — e.g. after accepting an organization invite,
 * `useOrganizationTeamProject` may have cached "no org" state that a soft
 * `router.push` would keep.
 *
 * Wrapped in a standalone module so tests can replace it via `vi.mock`;
 * `window.location` is non-configurable in jsdom and cannot be spied directly.
 */
/**
 * Whether a full-page navigation has been asked for and the next document has
 * not arrived yet.
 *
 * The browser hands out no signal for this. Between the assignment and the new
 * document committing, the page carries on rendering and its in-flight
 * requests carry on failing — and a fetch the unload aborted is
 * indistinguishable from a server that could not be reached. A screen that
 * draws its "we could not reach anything" card off that tells somebody their
 * sign-up broke, in the moment before the page they were being taken to
 * arrives.
 *
 * One-way on purpose: the next document starts with a fresh module, so there
 * is nothing to reset. A navigation the browser declines to make is not a
 * state this module can observe, and a screen left waiting is the better wrong
 * answer of the two.
 */
let navigatingAway = false;

export function isNavigatingAway(): boolean {
  return navigatingAway;
}

export function hardRedirect(url: string): void {
  navigatingAway = true;
  window.location.href = url;
}
