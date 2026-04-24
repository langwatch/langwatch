/**
 * Replace the first URL path segment with the given project slug, preserving
 * the rest of the path and query string.
 *
 * Used by `useOrganizationTeamProject` when the URL's project slug doesn't
 * resolve to a real project (e.g. an unfilled `[project]` placeholder from
 * docs/templates, or a stale slug from a different account). The user's
 * intent is the SECTION they tried to reach — we just substitute the real
 * project slug and let them land there.
 *
 * Examples:
 *   ("/[project]/evaluations", "ad-demo") → "/ad-demo/evaluations"
 *   ("/[project]/annotations/my-queue", "ad-demo") → "/ad-demo/annotations/my-queue"
 *   ("/[project]/messages?topics=x", "ad-demo") → "/ad-demo/messages?topics=x"
 *   ("/[project]", "ad-demo") → "/ad-demo"
 */
export function buildProjectRedirectPath(params: {
  asPath: string;
  projectSlug: string;
}): string {
  const { asPath, projectSlug } = params;

  // Split off query (?) and hash (#) so they can ride through intact. Whichever
  // appears first bounds the path portion.
  const qIndex = asPath.indexOf("?");
  const hIndex = asPath.indexOf("#");
  const suffixStart =
    qIndex === -1 ? hIndex : hIndex === -1 ? qIndex : Math.min(qIndex, hIndex);

  const pathPart = suffixStart === -1 ? asPath : asPath.slice(0, suffixStart);
  const suffix = suffixStart === -1 ? "" : asPath.slice(suffixStart);

  const firstSegmentEnd = pathPart.indexOf("/", 1);
  const tail = firstSegmentEnd === -1 ? "" : pathPart.slice(firstSegmentEnd);

  return `/${projectSlug}${tail}${suffix}`;
}
