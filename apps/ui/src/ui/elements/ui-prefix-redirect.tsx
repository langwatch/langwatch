import { Navigate, useLocation, useParams } from "react-router";

/** A `:name` placeholder inside a redirect's own strings, not a route path. */
const ROUTE_PARAM = /:([A-Za-z_$][\w$]*)/g;

/**
 * Fills `:name` placeholders from the matched route params.
 */
function fillParams(
  template: string,
  params: Readonly<Record<string, string | undefined>>,
): string {
  return template.replace(ROUTE_PARAM, (whole, name: string) => params[name] ?? whole);
}

/**
 * Permanent client-side redirect for a URL prefix that moved. A route element instead
 * of a `loader` redirect because loaders do not run on a cold load of the SPA, which is
 * exactly how a stale bookmark or emailed link arrives.
 */
export function UiPrefixRedirect({
  from,
  to,
  pinParams,
  mapSegment,
}: {
  from: string;
  to: string;
  /**
   * Query params forced onto the destination, overriding whatever the old address
   * carried under those keys.
   */
  pinParams?: Record<string, string>;
  /**
   * A rename table for the FIRST segment of the sub-path, applied before it is appended
   * to the destination.
   */
  mapSegment?: Record<string, string>;
}) {
  const location = useLocation();
  const params = useParams();

  const start = fillParams(from, params);
  const target = fillParams(to, params);
  const suffix = location.pathname.startsWith(start) ? location.pathname.slice(start.length) : "";

  let pathname = target + suffix;
  if (mapSegment) {
    const [first, ...deeper] = suffix.split("/").filter(Boolean);
    const renamed = first === void 0 ? void 0 : mapSegment[first.toLowerCase()];
    pathname = renamed === void 0 ? target : [target, renamed, ...deeper].join("/");
  }

  // Only the pinParams path re-serializes the query; without it the
  // original search travels byte-for-byte, as it always has.
  let search = location.search;
  if (pinParams) {
    const query = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(pinParams)) {
      query.set(key, fillParams(value, params));
    }
    search = query.toString();
  }
  return (
    <Navigate
      to={{
        pathname,
        search,
        hash: location.hash,
      }}
      replace
    />
  );
}
