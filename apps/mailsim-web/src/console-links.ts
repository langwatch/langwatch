import type { ConsoleLink } from "@langwatch/design-system-internal";

const MAIL_HOST = /^mail\.([a-z0-9-]+)\.langwatch\.localhost$/u;

/**
 * The other consoles, read off this page's own address: the inbox lives at
 * mail.<slug>.langwatch.localhost, the stack's home one label up and the hub
 * beside it. A standalone sink has neither and links nowhere.
 */
export const consoleLinks = ({
  location,
}: {
  location: Pick<Location, "protocol" | "hostname" | "port">;
}) => {
  const slug = MAIL_HOST.exec(location.hostname)?.[1];
  if (slug === undefined) return { links: [] };
  const origin = ({ host }: { host: string }) =>
    `${location.protocol}//${host}${location.port === "" ? "" : `:${location.port}`}`;
  const homeHref = origin({ host: `${slug}.langwatch.localhost` });
  const links: ConsoleLink[] = [
    { label: "Home", href: homeHref },
    { label: "Mail", href: "/", current: true },
    { label: "Hub", href: origin({ host: "hub.langwatch.localhost" }) },
  ];
  return { slug, homeHref, links };
};
