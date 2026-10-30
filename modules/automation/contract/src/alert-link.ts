/**
 * The marker an alert's email and Slack links to our own app carry, so the app can count a
 * landing from an alert, and the one product event it sends for it, which the host composes as
 * `automations.opened.alert_link`: the page the link opened, never a trace, chart or automation id.
 * @see modules/automation/specs/alert-link-opened.feature
 */

/** The query parameter an alert link carries, and its one value. */
export const ALERT_LINK_PARAM = "lw_from";
export const ALERT_LINK_VALUE = "alert";

/** The page an alert link opens: a trace, a custom chart, or anything else. */
export const ALERT_LINK_LANDINGS = ["trace", "graph", "other"] as const;
export type AlertLinkLanding = (typeof ALERT_LINK_LANDINGS)[number];

/**
 * The link with the alert marker set, kept before any `#hash`; a link to another site, a
 * relative link or a dead `#` link is returned unchanged.
 */
export function withAlertLinkMarker({
  url,
  appBaseUrl,
}: {
  url: string;
  appBaseUrl: string;
}): string {
  if (!URL.canParse(url) || !URL.canParse(appBaseUrl)) return url;
  const link = new URL(url);
  if (link.origin !== new URL(appBaseUrl).origin) return url;
  link.searchParams.set(ALERT_LINK_PARAM, ALERT_LINK_VALUE);
  return link.toString();
}

/** True when the query string says the page was opened from an alert. */
export function isAlertLinkSearch(search: string): boolean {
  return new URLSearchParams(search).get(ALERT_LINK_PARAM) === ALERT_LINK_VALUE;
}

/** Which page an alert link opened, from its path alone. */
export function alertLinkLandingOf(pathname: string): AlertLinkLanding {
  if (/\/traces\/[^/]+/.test(pathname)) return "trace";
  if (/\/analytics\/custom\/[^/]+/.test(pathname)) return "graph";
  return "other";
}

/** The event, shaped as the browser host's analytics event; never an id or a URL. */
export type AlertLinkOpenedEvent = Readonly<{
  boundary: "automations";
  action: "opened";
  name: "alert_link";
  attributes: Readonly<{ landedOn: AlertLinkLanding }>;
}>;

/** A member opened the app from a link in an alert. */
export function alertLinkOpened({
  landedOn,
}: {
  landedOn: AlertLinkLanding;
}): AlertLinkOpenedEvent {
  return {
    boundary: "automations",
    action: "opened",
    name: "alert_link",
    attributes: { landedOn },
  };
}
