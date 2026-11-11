/**
 * Sets a sender's marker in the query of a link to our own app, so the app can count the landing.
 * One implementation for every channel that marks links: the trigger digest email and Slack.
 * @see modules/automation/specs/alert-link-opened.feature
 */

/** The query pair a marked link carries. */
export interface LinkMarker {
  readonly param: string;
  readonly value: string;
}

/**
 * The link with the marker set, kept before any `#hash`; a link to another site, a relative link
 * or a dead `#` link is returned unchanged.
 */
export function withLinkMarker({
  url,
  appBaseUrl,
  marker,
}: {
  url: string;
  appBaseUrl: string;
  marker: LinkMarker;
}): string {
  if (!URL.canParse(url) || !URL.canParse(appBaseUrl)) return url;
  const link = new URL(url);
  if (link.origin !== new URL(appBaseUrl).origin) return url;
  link.searchParams.set(marker.param, marker.value);
  return link.toString();
}
