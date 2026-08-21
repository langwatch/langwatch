import { Navigate, useLocation } from "react-router";

/**
 * Permanent client-side redirect for a URL prefix that moved. A route
 * element instead of a `loader` redirect because loaders do not run on a
 * cold load of the SPA, which is exactly how a stale bookmark or emailed
 * link arrives. Keeps the sub-path, query string and hash, and replaces the
 * history entry so the back button never returns to the retired address.
 */
export function LegacyPrefixRedirect({
  from,
  to,
  ensureParams,
}: {
  from: string;
  to: string;
  /**
   * Query params guaranteed on the destination, set only when the old
   * address does not already carry the key. Used when the old address's
   * bare form had a meaning the new address's default changed — e.g.
   * `/governance/catalog` always meant the sources surface, so its
   * redirect pins `?tab=sources` on the tabbed inventory page.
   */
  ensureParams?: Record<string, string>;
}) {
  const location = useLocation();
  const suffix = location.pathname.startsWith(from)
    ? location.pathname.slice(from.length)
    : "";
  const search = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(ensureParams ?? {})) {
    if (!search.has(key)) search.set(key, value);
  }
  return (
    <Navigate
      to={{
        pathname: to + suffix,
        search: search.toString(),
        hash: location.hash,
      }}
      replace
    />
  );
}
