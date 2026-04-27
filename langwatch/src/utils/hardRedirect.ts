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
export function hardRedirect(url: string): void {
  window.location.href = url;
}
