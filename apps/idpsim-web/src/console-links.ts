import type { ConsoleLink } from "@langwatch/design-system-internal";

const IDP_HOST = /^idp(?:\.([a-z0-9-]+))?\.langwatch\.localhost$/u;

/**
 * The other consoles, read off this page's own address: idp.<slug> has a home
 * one label up, the machine-wide idp has only the hub, a bare port nothing.
 */
export const consoleLinks = ({
  location,
}: {
  location: Pick<Location, "protocol" | "hostname" | "port">;
}): { slug?: string; homeHref?: string; links: ConsoleLink[] } => {
  const match = IDP_HOST.exec(location.hostname);
  if (match === null) return { links: [] };
  const origin = ({ host }: { host: string }) =>
    `${location.protocol}//${host}${location.port === "" ? "" : `:${location.port}`}`;
  const hub: ConsoleLink = { label: "Hub", href: origin({ host: "hub.langwatch.localhost" }) };
  const idp: ConsoleLink = { label: "Identity", href: "/", current: true };
  const slug = match[1];
  if (slug === undefined) return { links: [idp, hub] };
  const homeHref = origin({ host: `${slug}.langwatch.localhost` });
  return {
    slug,
    homeHref,
    links: [
      { label: "Home", href: homeHref },
      idp,
      { label: "Mail", href: origin({ host: `mail.${slug}.langwatch.localhost` }) },
      hub,
    ],
  };
};
