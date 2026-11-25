/**
 * Which page owns each action manifest, by the address the browser is on. The
 * address changes at once on a route change, long before the page's code has
 * loaded, so it says "the handlers for this kind are about to register".
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
