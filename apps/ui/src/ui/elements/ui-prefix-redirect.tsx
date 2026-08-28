import { Navigate, useLocation } from "react-router";

/**
 * Permanent client-side redirect for a URL prefix that moved. A route
 * element instead of a `loader` redirect because loaders do not run on a
 * cold load of the SPA, which is exactly how a stale bookmark or emailed
 * link arrives. Keeps the sub-path, query string and hash, and replaces the
 * history entry so the back button never returns to the retired address.
 */
export function UiPrefixRedirect({
  from,
  to,
  pinParams,
}: {
  from: string;
  to: string;
  /**
   * Query params forced onto the destination, overriding whatever the old
   * address carried under those keys. Every other key keeps its value and
   * position, though the query is re-serialized, so an encoding variant
   * may normalize (`%20` arrives as `+`); the decoded value is unchanged.
   * Used when the old address's meaning is not expressible on the new one
   * by default — `/governance/catalog` served exactly one pane, so every
   * `?tab=` value it ever carried rendered the sources list, and the
   * redirect has to pin `?tab=sources` rather than honour a stale value
   * that now names a different pane.
   */
  pinParams?: Record<string, string>;
}) {
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
