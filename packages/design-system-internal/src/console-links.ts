import type { ConsoleLink } from "./layout/top-bar.tsx";

/** The haven naming scheme (tools/thuishaven/domain/naming.go). */
const DOMAIN = "langwatch.localhost";
const LABEL = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
/** One-label hosts that belong to the machine, never a stack: no home, the hub alone. */
const MACHINE_WIDE = new Set(["hub", "idp", "observability", "telemetry", "langwatch"]);

/** Each console of a stack: `null` is the stack home, `<slug>.langwatch.localhost`. */
const CONSOLES: { label: string; service: string | null }[] = [
  { label: "Home", service: null },
  { label: "Hub", service: "hub" },
  { label: "App", service: "app" },
  { label: "Mail", service: "mail" },
  { label: "IdP", service: "idp" },
  { label: "Design system", service: "design-system" },
  { label: "Mail room", service: "mail-room" },
];

export type ConsoleLocation = Pick<Location, "protocol" | "hostname" | "port">;

export type ConsoleLinks = {
  slug?: string;
  homeHref?: string;
  hubHref?: string;
  links: ConsoleLink[];
};

/** Where a host sits in the scheme: a stack's (with its slug), the machine's, or outside it. */
const placeOf = ({ hostname }: { hostname: string }) => {
  const labels = hostname.toLowerCase().split(".");
  const domain = DOMAIN.split(".");
  if (labels.slice(-domain.length).join(".") !== DOMAIN) return undefined;
  const own = labels.slice(0, -domain.length);
  const slug = own.at(-1);
  if (own.length === 0) return {};
  if (own.length > 2 || slug === undefined) return undefined;
  const wellFormed = own.every((label) => LABEL.test(label));
  if (!wellFormed) return undefined;
  if (!MACHINE_WIDE.has(slug)) return { slug };
  return own.length === 1 ? {} : undefined;
};

/**
 * The stack's consoles, read off this page's address, keeping its scheme and
 * port; the one this page is on is `current`. A machine-wide host links the
 * hub alone; a host outside the scheme (localhost) answers no links.
 */
export const consoleLinks = ({ location }: { location: ConsoleLocation }): ConsoleLinks => {
  const place = placeOf({ hostname: location.hostname });
  if (place === undefined) return { links: [] };
  const port = location.port === "" ? "" : `:${location.port}`;
  const here = location.hostname.toLowerCase();
  const linkTo = ({ label, host }: { label: string; host: string }): ConsoleLink => {
    const link = { label, href: `${location.protocol}//${host}${port}` };
    return host === here ? { ...link, current: true } : link;
  };
  const hub = linkTo({ label: "Hub", host: `hub.${DOMAIN}` });
  if (place.slug === undefined) return { hubHref: hub.href, links: [hub] };
  const { slug } = place;
  const hostOf = ({ service }: { service: string | null }) => {
    if (service === null) return `${slug}.${DOMAIN}`;
    return service === "hub" ? `hub.${DOMAIN}` : `${service}.${slug}.${DOMAIN}`;
  };
  const links = CONSOLES.map(({ label, service }) => linkTo({ label, host: hostOf({ service }) }));
  const homeHref = `${location.protocol}//${hostOf({ service: null })}${port}`;
  return { slug, homeHref, hubHref: hub.href, links };
};
