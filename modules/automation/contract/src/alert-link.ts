/**
 * The marker an alert's own links carry, so the app can count a landing from an alert, and the
 * one product event it sends for it: `automations.opened.alert_link` once the host composes it.
 * It carries which page the link opened, never the trace, chart or automation id. Pure.
 * @see modules/automation/specs/alert-link-opened.feature
 */

/** The query parameter an alert link carries, and its one value. */
export const ALERT_LINK_PARAM = "lw_from";
export const ALERT_LINK_VALUE = "alert";

/** The page an alert link opens: a trace, a custom chart, or anything else. */
export const ALERT_LINK_LANDINGS = ["trace", "graph", "other"] as const;
export type AlertLinkLanding = (typeof ALERT_LINK_LANDINGS)[number];

/** The link with the alert marker added; a dead `#` link stays as it is. */
export function withAlertLinkMarker(url: string): string {
  if (url === "#") return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${ALERT_LINK_PARAM}=${ALERT_LINK_VALUE}`;
}

/** True when the query string says the page was opened from an alert. */
export function isAlertLinkSearch(search: string): boolean {
  return new URLSearchParams(search).get(ALERT_LINK_PARAM) === ALERT_LINK_VALUE;
}

/** The query string without the alert marker, with a leading `?` when anything is left. */
export function searchWithoutAlertMarker(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(ALERT_LINK_PARAM);
  const rest = params.toString();
  return rest === "" ? "" : `?${rest}`;
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
