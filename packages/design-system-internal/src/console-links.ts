import type { ConsoleLink } from "./components/top-bar.tsx";

/** The haven naming scheme (tools/thuishaven/domain/naming.go). */
const DOMAIN = "langwatch.localhost";
const LABEL = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
/** One-label hosts that belong to the machine, never a stack: no home, no links. */
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

export type ConsoleLinks = { slug?: string; homeHref?: string; links: ConsoleLink[] };

/** The stack slug a host names, from `<service>.<slug>.` or `<slug>.langwatch.localhost`. */
const slugOf = ({ hostname }: { hostname: string }) => {
  const labels = hostname.toLowerCase().split(".");
  const domain = DOMAIN.split(".");
  if (labels.slice(-domain.length).join(".") !== DOMAIN) return undefined;
  const own = labels.slice(0, -domain.length);
  const slug = own.at(-1);
  if (own.length < 1 || own.length > 2 || slug === undefined) return undefined;
  const wellFormed = own.every((label) => LABEL.test(label));
  if (!wellFormed) return undefined;
  return MACHINE_WIDE.has(slug) ? undefined : slug;
};

/**
 * The stack's consoles, read off this page's own address and keeping its
 * scheme and port; the one this page is on is `current`. A host outside the
 * scheme (a standalone sink on localhost) answers no links.
 */
export const consoleLinks = ({ location }: { location: ConsoleLocation }): ConsoleLinks => {
  const slug = slugOf({ hostname: location.hostname });
  if (slug === undefined) return { links: [] };
  const port = location.port === "" ? "" : `:${location.port}`;
  const hostOf = ({ service }: { service: string | null }) => {
    if (service === null) return `${slug}.${DOMAIN}`;
    return service === "hub" ? `hub.${DOMAIN}` : `${service}.${slug}.${DOMAIN}`;
  };
  const here = location.hostname.toLowerCase();
  const links = CONSOLES.map(({ label, service }): ConsoleLink => {
    const host = hostOf({ service });
    const link = { label, href: `${location.protocol}//${host}${port}` };
    return host === here ? { ...link, current: true } : link;
  });
  return { slug, homeHref: `${location.protocol}//${hostOf({ service: null })}${port}`, links };
};
