import { Navigate, useLocation } from "react-router";

/**
 * Permanent client-side redirect for a URL prefix that moved. A route
 * element instead of a `loader` redirect because loaders do not run on a
 * cold load of the SPA, which is exactly how a stale bookmark or emailed
 * link arrives. Keeps the sub-path, query string and hash, and replaces the
 * history entry so the back button never returns to the retired address.
 */
export function LegacyPrefixRedirect({ from, to }: { from: string; to: string }) {
  const location = useLocation();
  const suffix = location.pathname.startsWith(from)
    ? location.pathname.slice(from.length)
    : "";
  // Only the pinParams path re-serializes the query; without it the
  // original search travels byte-for-byte, as it always has.
  let search = location.search;
  if (pinParams) {
    const params = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(pinParams)) {
      params.set(key, value);
    }
    search = params.toString();
  }
  return (
    <Navigate
      to={{
        pathname: to + suffix,
        search,
        hash: location.hash,
      }}
      replace
    />
  );
}
