import { Navigate, useLocation, useParams } from "react-router";

/** A `:name` placeholder inside a redirect's own strings, not a route path. */
const ROUTE_PARAM = /:([A-Za-z_$][\w$]*)/g;

/**
 * Fills `:name` placeholders from the matched route params.
 *
 * A retired address inside a parameterised family — `/:project/messages/:trace`
 * — has to name its destination in terms of the same params, and a table of
 * data cannot call `useParams` itself. A name the match did not bind is left
 * verbatim rather than blanked, so a literal colon in copy survives.
 */
function fillParams(
  template: string,
  params: Readonly<Record<string, string | undefined>>,
): string {
  return template.replace(ROUTE_PARAM, (whole, name: string) => params[name] ?? whole);
}

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
  mapSegment,
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
   * that now names a different pane. A value may name a route param
   * (`:trace`), which is how a retired deep link hands its own id to the
   * drawer that replaced the page.
   */
  pinParams?: Record<string, string>;
  /**
   * A rename table for the FIRST segment of the sub-path, applied before it
   * is appended to the destination. `/admin/user/u_1` became
   * `/ops/backoffice/users/u_1` when the resources were pluralised, and the
   * segment names are the only thing that varies, so they travel as data
   * rather than as a page. Lookup is case-insensitive. A first segment the
   * table does not name is a resource that did not move: the reader lands on
   * the destination's own home rather than on a fabricated address under it.
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
