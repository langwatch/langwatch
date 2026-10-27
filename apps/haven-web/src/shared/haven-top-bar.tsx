import { TopBar, consoleLinks, type ConsoleLink } from "@langwatch/design-system-internal";
import type { ReactNode } from "react";

import type { HubStack, Surface } from "./contract.ts";
import { consolesOf } from "./surfaces.ts";

export type HavenPlace = "hub" | "logs" | "settings" | "home";

export type HavenTopBarProps = {
  current: HavenPlace;
  /** `/` on the hub itself, the hub's absolute URL from a stack's home. */
  hubHref: string;
  /** The stack a home belongs to; the hub has none. */
  home?: { slug: string; href: string; surfaces: Surface[] };
  /** On the hub: the machine's stacks, whose live consoles the bar links. */
  stacks?: HubStack[];
  actions?: ReactNode;
};

const trimSlash = ({ href }: { href: string }) => href.replace(/\/+$/, "");

const hostOf = ({ href }: { href: string }) => {
  try {
    return new URL(href).hostname;
  } catch {
    return "";
  }
};

/** The kit's consoles for this stack, less those the daemon reports as not answering. */
const answering = ({ links, surfaces }: { links: ConsoleLink[]; surfaces: Surface[] }) => {
  const live = new Set(consolesOf({ surfaces }).map((link) => hostOf({ href: link.href })));
  const known = new Set(surfaces.map((surface) => hostOf({ href: surface.url })));
  return links.filter((link) => {
    const host = hostOf({ href: link.href });
    return !known.has(host) || live.has(host);
  });
};

/** Off the scheme (a dev server on localhost), the hub and the home haven was told about. */
const fallback = ({
  hub,
  home,
  current,
}: Pick<HavenTopBarProps, "home" | "current"> & { hub: string }) => [
  { label: "Hub", href: hub === "" ? "/" : hub, current: current === "hub" },
  ...(home === undefined ? [] : [{ label: "Home", href: home.href, current: current === "home" }]),
];

/** The hub's consoles: one live stack's as they are; several, each named for its stack. */
const hubConsoles = ({ stacks }: { stacks: HubStack[] }): ConsoleLink[] => {
  const live = stacks.filter((stack) => stack.live);
  const all = live.flatMap(({ slug, surfaces }) =>
    consolesOf({ surfaces }).map((link) => ({ slug, link })),
  );
  const timesSeen = ({ href }: { href: string }) =>
    all.filter(({ link }) => link.href === href).length;
  const unique = all.filter(
    ({ link }, index) => all.findIndex((other) => other.link.href === link.href) === index,
  );
  if (live.length < 2) return unique.map(({ link }) => link);
  return unique.map(({ slug, link }) => {
    if (timesSeen({ href: link.href }) > 1) return link;
    if (link.group === undefined) return { ...link, label: slug, group: link.label };
    return { ...link, label: `${slug} · ${link.label}` };
  });
};

/**
 * One bar for every haven page: the kit's links for this address (the hub,
 * or this stack's consoles that answer), then haven's own; sims and tools sit in menus.
 */
export const HavenTopBar = ({ current, hubHref, home, stacks = [], actions }: HavenTopBarProps) => {
  const hub = trimSlash({ href: hubHref });
  const { slug, links, homeHref, hubHref: kitHub } = consoleLinks({ location: window.location });
  const found =
    home === undefined
      ? links.filter((link) => link.href === homeHref || link.href === kitHub)
      : answering({ links, surfaces: home.surfaces });
  const offKit = current === "logs" || current === "settings";
  const kit = offKit ? found.map(({ label, href }) => ({ label, href })) : found;
  const logs: ConsoleLink = {
    label: "Logs",
    href: home === undefined ? `${hub}/logs` : `${hub}/logs/${encodeURIComponent(home.slug)}`,
    current: current === "logs",
  };
  const settings: ConsoleLink[] =
    home === undefined
      ? [{ label: "Settings", href: `${hub}/settings`, current: current === "settings" }]
      : [];
  const hosts = new Set(kit.map((link) => hostOf({ href: link.href })));
  const consoles =
    home === undefined ? hubConsoles({ stacks }) : consolesOf({ surfaces: home.surfaces });
  const extras = consoles.filter((link) => !hosts.has(hostOf({ href: link.href })));
  return (
    <TopBar
      name="haven"
      slug={home?.slug ?? slug}
      homeHref={home === undefined ? "/" : home.href}
      links={[
        ...(kit.length === 0 ? fallback({ hub, home, current }) : kit),
        logs,
        ...settings,
        ...extras,
      ]}
      actions={actions}
    />
  );
};
