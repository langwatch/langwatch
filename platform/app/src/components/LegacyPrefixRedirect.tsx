import { Navigate, useLocation } from "react-router";

/**
 * Permanent client-side redirect for a URL prefix that moved. A route
 * element instead of a `loader` redirect because loaders do not run on a
 * cold load of the SPA, which is exactly how a stale bookmark or emailed
 * link arrives. Keeps the sub-path, query string and hash, and replaces the
 * history entry so the back button never returns to the retired address.
 *
 * `search` adds default parameters to the target address (`"?tab=sources"`)
 * without ever clobbering what the old link already carried: an arriving
 * parameter wins, a missing one is filled from here.
 */
export function LegacyPrefixRedirect({
  from,
  to,
  search,
}: {
  from: string;
  to: string;
  search?: string;
}) {
  const location = useLocation();
  const suffix = location.pathname.startsWith(from)
    ? location.pathname.slice(from.length)
    : "";

  let target = to + suffix;
  let incoming = location.search;
  if (search) {
    const merged = new URLSearchParams(location.search);
    for (const [key, value] of new URLSearchParams(search)) {
      if (!merged.has(key)) merged.set(key, value);
    }
    const mergedString = merged.toString();
    incoming = mergedString ? `?${mergedString}` : "";
    // The defaults live in the query now; leaving them in the path would
    // make the router read `?tab=...` as path segments.
    target = target.split("?")[0] ?? target;
  }

  return (
    <Navigate
      to={{
        pathname: target,
        search: incoming,
        hash: location.hash,
      }}
      replace
    />
  );
}
