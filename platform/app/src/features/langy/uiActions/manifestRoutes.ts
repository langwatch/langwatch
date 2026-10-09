/**
 * Which page owns each action manifest, by the address the browser is on.
 *
 * A page registers its handlers when it mounts, and an agent that has just
 * navigated to a page dispatches its first action while that mount is still
 * under way. The address changes at once on a route change, long before the
 * page's code has loaded, so it is what says "the handlers for this kind are
 * about to register" and lets the panel hold the action for the page rather
 * than leave it to the server's saved-state fallback.
 *
 * Only manifests listed here are held. A kind of any other manifest keeps the
 * older rule: no handler, no claim.
 */
const MANIFEST_ROUTES: Record<string, RegExp> = {
  // /<project>/traces, with or without a trailing path or the v2 fragment.
  explorer: /^\/[^/]+\/traces(\/|$)/,
};

/** Whether the browser is on the page that owns `kind`'s manifest. */
export function isOnPageOwningAction({
  kind,
  pathname,
}: {
  kind: string;
  pathname: string;
}): boolean {
  const domain = kind.split(".")[0] ?? "";
  const route = MANIFEST_ROUTES[domain];
  return route ? route.test(pathname) : false;
}
