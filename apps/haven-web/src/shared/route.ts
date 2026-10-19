/** What the console draws, read from the Host and the path. */
export type Route =
  | { kind: "hub"; page: "overview" }
  | { kind: "hub"; page: "logs"; stack: string; lane: string }
  | { kind: "hub"; page: "settings" }
  | { kind: "home"; slug: string; tab: string; sub: string };

type Where = { hostname: string; pathname: string };

const isAddress = ({ hostname }: { hostname: string }) =>
  hostname.includes(":") || /^[\d.]+$/.test(hostname);

/**
 * `<slug>.<domain>` is a stack's home; `hub.<domain>`, the bare domain, an IP
 * or plain `localhost` is the hub. The domain is at least two labels
 * (`langwatch.localhost`), so a home has three or more.
 */
export const stackSlugOf = ({ hostname }: { hostname: string }): string | undefined => {
  const labels = hostname.toLowerCase().split(".");
  const [first] = labels;
  if (isAddress({ hostname }) || labels.length < 3 || first === undefined || first === "hub") {
    return undefined;
  }
  return first;
};

const decode = ({ segment }: { segment: string }) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

export const readRoute = ({ hostname, pathname }: Where): Route => {
  const [page = "", second = "", lane = ""] = pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decode({ segment }));
  const slug = stackSlugOf({ hostname });
  if (slug !== undefined) return { kind: "home", slug, tab: page, sub: second };
  const stack = second;
  if (page === "logs") return { kind: "hub", page: "logs", stack, lane };
  if (page === "settings") return { kind: "hub", page: "settings" };
  return { kind: "hub", page: "overview" };
};

export const SETTINGS_PATH = "/settings";

/** The hub's log view for one stack and, optionally, one lane: the path logsUrl names. */
export const logsPath = ({ stack = "", lane = "" }: { stack?: string; lane?: string }) =>
  ["/logs", stack, stack === "" ? "" : lane]
    .filter((part) => part.length > 0)
    .map((part, index) => (index === 0 ? part : encodeURIComponent(part)))
    .join("/");

/** A stack console tab's path: `/` for the overview, `/<tab>[/<sub>]` otherwise. */
export const tabPath = ({ tab, sub = "" }: { tab: string; sub?: string }) =>
  tab === "overview"
    ? "/"
    : `/${encodeURIComponent(tab)}${sub === "" ? "" : `/${encodeURIComponent(sub)}`}`;
