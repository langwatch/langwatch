import { TopBar, type ConsoleLink } from "@langwatch/design-system-internal";
import type { ReactNode } from "react";

import type { Surface } from "./contract.ts";
import { consolesOf } from "./surfaces.ts";

export type HavenPlace = "hub" | "logs" | "home";

export type HavenTopBarProps = {
  current: HavenPlace;
  /** `/` on the hub itself, the hub's absolute URL from a stack's home. */
  hubHref: string;
  /** The stack a home belongs to; the hub has none. */
  home?: { slug: string; href: string; surfaces: Surface[] };
  actions?: ReactNode;
};

const trimSlash = ({ href }: { href: string }) => href.replace(/\/+$/, "");

/** One bar for every haven page: the hub, its logs, this stack's home and its consoles. */
export const HavenTopBar = ({ current, hubHref, home, actions }: HavenTopBarProps) => {
  const hub = trimSlash({ href: hubHref });
  const links: ConsoleLink[] = [
    { label: "Hub", href: hub === "" ? "/" : hub, current: current === "hub" },
    {
      label: "Logs",
      href: home === undefined ? `${hub}/logs` : `${hub}/logs/${encodeURIComponent(home.slug)}`,
      current: current === "logs",
    },
  ];
  if (home !== undefined) {
    links.push({ label: "Home", href: home.href, current: current === "home" });
    links.push(...consolesOf({ surfaces: home.surfaces }));
  }
  return (
    <TopBar
      name="haven"
      slug={home?.slug}
      homeHref={home === undefined ? "/" : home.href}
      links={links}
      actions={actions}
    />
  );
};
